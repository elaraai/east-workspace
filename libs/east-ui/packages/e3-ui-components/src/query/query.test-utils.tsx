/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's DOM test harness (#935, #936): the shared fixture's
 * orders and customers bound on a page — the orders paged, the customers
 * whole — and a saved queries record in memory whose patch door applies each
 * patch with East's own checks; the builder mounted through its carrier, as a
 * surface mounts it, with a host's one-shot call.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    BooleanType, East, OptionType, PatchType, SortedMap, StringType, applyFor, checkJq, compareFor, decodeBeast2, decodeBeast2For,
    encodeBeast2For, fromEastTypeValue, none, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import {
    Query, RecordBindHandleType, bindPagedPinnedPlatformFn, bindPlatformFn, queryKeys, recordBindPlatformFn,
} from "@elaraai/e3-ui/internal";
import { TreePathType } from "@elaraai/e3-types";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
import { QueryCallProvider, type QueryCall } from "./hooks.js";
import { queryRoot, type QueryRoot } from "./one-shot.js";
import { QueryOpenType, type QueryOpen } from "./open-query.js";
import type { SavedQuery } from "./session.js";
// The builder is an extension: its renderer registers as it loads.
import "./builder.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
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
    if (checked.query === null) throw new Error(`${program}: ${checked.diagnostics.map(d => d.message).join("; ")}`);
    return {
        name, description, query: checked.query, saved_at: new Date(Date.UTC(2026, 8, 30, 9, 0)),
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

/**
 * Mounts the builder as a surface mounts it: the record and two data sources
 * bound, with a host's one-shot call.
 *
 * @param call - How a one-shot call is made
 * @returns The rendered builder
 */
export async function mountBuilder(call?: QueryCall): Promise<RenderResult> {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const orders = $.let(bindPagedPinnedPlatformFn([OrdersType], ORDERS, East.value(none, OptionType(StringType)), East.value(false, BooleanType)));
        const customers = $.let(bindPlatformFn([CustomersType], CUSTOMERS, none, variant("direct", null)));
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        return Query.Builder({ queries: record as never, datasets: { orders: orders as never, customers: customers as never } });
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    const builder = <EastChakraComponent value={program()} storageKey="query-builder" />;
    const utils = render(
        <ChakraProvider value={system}>
            {call === undefined ? builder : <QueryCallProvider call={call}>{builder}</QueryCallProvider>}
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** The saved queries record, keyed by name. */
export function savedRecord(queries: readonly SavedQuery[]): Saved {
    return new SortedMap(queries.map((q): [string, SavedQuery] => [q.name, q]), keys);
}
