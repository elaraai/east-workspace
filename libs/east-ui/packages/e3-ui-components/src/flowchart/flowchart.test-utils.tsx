/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's DOM tests' shared harness (#1246–#1249): a record of flows
 * in memory, bound with its patch mutation, whose patch door applies each
 * patch with East's own checks — as an app binds one — beside any other
 * records a test binds too (a library tab's rows, #1248), and the flowchart
 * over it through its carrier, so a Save is a real commit — under the page's
 * drag layer where a test drags (#1249); the paging service over the records
 * a test's `Slice.bindRecords` pages through their indexes (#1346), each
 * index evaluated by its own East key function, the examples' records among
 * them; and the waits and presses its tests share.
 */

import { beforeAll, afterAll, vi } from "vitest";
import { act, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, PatchType, applyFor, decodeBeast2For, encodeBeast2For, variant, type BlockBuilder, type EastType, type ExprType, type PatchTypeOf, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { Flowchart, RecordBindHandleType, recordBindPlatformFn } from "@elaraai/e3-ui/internal";
import type { TreePath } from "@elaraai/e3-types";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, defaultPagedRuntime, initializePagedApi, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
import { countWholeReads, recordPaging, servedIndex, type DeclaredIndex, type PagedRecord } from "../platform/record-paging.test-utils.js";
// The flowchart is an extension: its renderer registers as it loads.
import "./index.js";

// jsdom has no layout. Give the real Library virtualizer a viewport instead
// of disabling virtualization in the production adapter for these tests — and
// each row of a paged Flows tab (#1346) the card's height its estimate is, as
// a browser draws it: jsdom's 0 would mount every row of a record of
// thousands, each measured afresh.
const libraryHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const libraryWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
/** A paged Library's row, as tall as its card (#1346). */
const PAGED_ROW_PX = 56;
let restoreLibrarySize = () => {};
beforeAll(() => {
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.closest("[data-flowchart-flows]") === null ? libraryHeight.get!.call(this) : 480;
    });
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.closest("[data-flowchart-flows]") === null ? libraryWidth.get!.call(this) : 272;
    });
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this instanceof HTMLElement && this.dataset["slot"] === "virtualRow" && this.closest("[data-library-paged]") !== null) {
            return { x: 0, y: 0, top: 0, left: 0, right: 272, bottom: PAGED_ROW_PX, width: 272, height: PAGED_ROW_PX, toJSON: () => ({}) } as DOMRect;
        }
        return rect.call(this);
    };
    restoreLibrarySize = () => { height.mockRestore(); width.mockRestore(); Element.prototype.getBoundingClientRect = rect; };
});
afterAll(() => restoreLibrarySize());

type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;
type UIValue = ValueTypeOf<typeof UIComponentType>;

/** Let the store's writes, the sessions, the record's commits and the renders settle. */
export async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The frame's toolbar, where the history item is. */
export const toolbar = () => within(document.querySelector("[data-frame-slot='toolbar']") as HTMLElement);

/**
 * Presses one of the history item's buttons, by its words, as a pointer does.
 *
 * @param name - The button's accessible name
 */
export async function press(name: string): Promise<void> {
    const button = toolbar().getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/**
 * Whether one of the history item's buttons is on.
 *
 * @param name - The button's accessible name
 * @returns Whether it is enabled
 */
export const enabled = (name: string): boolean => !(toolbar().getByRole("button", { name }) as HTMLButtonElement).disabled;

/** The workspace the records live in. */
export const WORKSPACE = "flowchart-test";
const RECORD = "depot_flows";
const FlowsHandle = RecordBindHandleType(Flowchart.Types.Flows, { patch: [PatchType(Flowchart.Types.Flows)] });

/** The record in memory, and the dataset cache it writes through. */
export interface RecordHarness {
    /** The record API in memory: its commits. */
    readonly memory: RecordApi;
    /** The dataset cache its record is read through. */
    readonly cache: ReactiveDatasetCache;
    /** Each request the paging service was sent, as `<path> <op> <where>` (#1346). */
    readonly requests: readonly string[];
    /** Each dataset read whole, by its path's text, in order, while the service pages a record (#1346); none counted without. */
    readonly wholeReads: readonly string[];
}

/** A record as e3 declares it (`e3.record`): its name, where it lives, its type and its declared state. */
export interface DeclaredRecord {
    readonly name: string;
    readonly path: TreePath;
    readonly type: EastType;
    readonly default?: unknown;
}

/**
 * A record of the examples', in memory beside the flows, with its patch
 * mutation: as {@link recordHarness} takes another record.
 *
 * @param record - The record, as the examples declare it
 * @returns The other record
 */
export function exampleRecord(record: DeclaredRecord): OtherRecord {
    return { name: record.name, type: record.type, initial: record.default };
}

/**
 * A record the paging service serves through its indexes, each its own East
 * key function's, compiled — as e3 serves a record a `Slice.bindRecords`
 * pages (#1346).
 *
 * @param record - The record, as the examples declare it
 * @param indexes - Its indexes, as the examples declare them
 * @returns What the service serves
 */
export function servedRecord(record: DeclaredRecord, indexes: readonly DeclaredIndex[]): PagedRecord {
    return { path: record.path, type: record.type as PagedRecord["type"], indexes: indexes.map(servedIndex) };
}

/**
 * Another record in memory beside the flows — a library tab's rows (#1248):
 * its name, its keyed type and its rows.
 *
 * @typeParam T - Its type: a Dict, as every record's
 */
export interface OtherRecord<T extends EastType = EastType> {
    /** Its name: what a test binds it by. */
    readonly name: string;
    /** Its type. */
    readonly type: T;
    /** Its rows. */
    readonly initial: ValueTypeOf<T>;
}

/**
 * A record of flows in memory, bound with its patch mutation, whose patch door
 * applies each patch with East's own checks — and, beside it, any other
 * records given, each with a patch mutation of its own; and the paging service
 * over the records given to page, which a slice reads through their indexes
 * (#1346).
 *
 * @param initial - The record's flows
 * @param others - The other records, each with its patch mutation
 * @param paged - The records the paging service serves, through their indexes
 * @returns The harness
 */
export function recordHarness(initial: Flows, others: readonly { readonly name: string; readonly type: EastType; readonly initial: unknown }[] = [],
    paged: readonly PagedRecord[] = []): RecordHarness {
    // Each harness its own paged windows: another test's never answer this one's reads.
    defaultPagedRuntime.clear();
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
    const applyPatch = applyFor(Flowchart.Types.Flows);
    const memory = createInMemoryRecordApi(cache, WORKSPACE, [{
        name: RECORD, stateType: Flowchart.Types.Flows, initial,
        mutations: [{ name: "patch", argTypes: [PatchType(Flowchart.Types.Flows)], reduce: (state, patch) => applyPatch(state as never, patch as never) }],
    }, ...others.map((other) => {
        const apply = applyFor(other.type);
        return {
            name: other.name, stateType: other.type, initial: other.initial,
            mutations: [{ name: "patch", argTypes: [PatchType(other.type)], reduce: (state: unknown, patch: unknown) => apply(state as never, patch as never) }],
        };
    })]);
    if (paged.length === 0) {
        initializeRecordApi(memory, cache, WORKSPACE);
        const paging = recordPaging(cache, cache.read.bind(cache), paged);
        initializePagedApi(paging.api, WORKSPACE);
        return { memory, cache, requests: paging.requests, wholeReads: [] };
    }
    // A record paged as e3 serves one: each state it commits named by its content's hash, the revision its paged reads
    // move to — so a Save's revision is the one its reads confirm at — and every whole read of a dataset counted, which
    // the service's own reads are not.
    const reads = countWholeReads(cache);
    initializeRecordApi(reads.serve(memory), cache, WORKSPACE);
    const paging = recordPaging(cache, reads.raw, paged);
    initializePagedApi(paging.api, WORKSPACE);
    return { memory, cache, requests: paging.requests, wholeReads: reads.paths };
}

/**
 * Commits a patch to another record through its patch mutation, as another
 * writer does — what the flowchart reads it through moves.
 *
 * @param harness - The records in memory
 * @param other - The record
 * @param patch - The patch, of the record's type
 * @returns The mutation's outcome
 */
export async function commitOther<T extends EastType>(harness: RecordHarness, other: OtherRecord<T>, patch: ValueTypeOf<PatchTypeOf<T>>): Promise<string> {
    const result = await harness.memory.mutate(WORKSPACE, other.name, "patch", { args: [encodeBeast2For(PatchType(other.type))(patch)] });
    return result.outcome.type;
}

/**
 * The record as it stands — what its patch door last wrote.
 *
 * @param harness - The record in memory
 * @returns Its flows
 */
export function readRecord(harness: RecordHarness): Flows {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", RECORD)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(Flowchart.Types.Flows)(bytes);
}

/**
 * The patch mutations the record has committed, newest first, after its first state.
 *
 * @param harness - The record in memory
 * @returns Each commit's mutation
 */
export async function commits(harness: RecordHarness): Promise<string[]> {
    return (await harness.memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation);
}

/**
 * Binds another record of the harness's, as a surface's body binds one, with
 * its patch mutation.
 *
 * @param $ - The surface's body
 * @param other - The record
 * @returns Its bind handle
 */
export function bindOther<T extends EastType>($: BlockBuilder<UIComponentType>, other: OtherRecord<T>): { read: () => ExprType<T> } {
    const handle = RecordBindHandleType(other.type, { patch: [PatchType(other.type)] });
    return $.let(recordBindPlatformFn([handle], other.name)) as unknown as { read: () => ExprType<T> };
}

/**
 * The flowchart over the record, as a surface mounts it: `<Flowchart>` built
 * over the bound record, compiled, and rendered through its carrier.
 *
 * @param props - Its props beside `record` — or what makes them in the surface's body, where it binds other records; the Flows tab listed, by default
 * @param options - `drag`: under the drag layer an app mounts once at its root, as the showcase does — its library's cards drag, and its canvas takes them (#1249)
 * @returns The render
 */
export async function mountRecord(
    props: object | (($: BlockBuilder<UIComponentType>) => object) = { library: [Flowchart.library.flows()] },
    options: { readonly drag?: boolean } = {},
): Promise<RenderResult> {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const flows = $.let(recordBindPlatformFn([FlowsHandle], RECORD));
        return Flowchart({ record: flows as never, ...(typeof props === "function" ? props($) : props) });
    }))), getRegisteredPlatformImplementations()) as () => UIValue;
    const flowchart = <EastChakraComponent value={program()} storageKey="flowchart-record" />;
    const utils = render(
        <ChakraProvider value={system}>
            {options.drag === true ? <DragLayerProvider>{flowchart}</DragLayerProvider> : flowchart}
        </ChakraProvider>,
    );
    await settle();
    return utils;
}
