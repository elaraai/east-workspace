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
 * drag layer where a test drags (#1249); and the waits and presses its tests
 * share.
 */

import { act, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, PatchType, applyFor, decodeBeast2For, encodeBeast2For, variant, type BlockBuilder, type EastType, type ExprType, type PatchTypeOf, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { Flowchart, RecordBindHandleType, recordBindPlatformFn } from "@elaraai/e3-ui/internal";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
// The flowchart is an extension: its renderer registers as it loads.
import "./index.js";

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

const WORKSPACE = "flowchart-test";
const RECORD = "depot_flows";
const FlowsHandle = RecordBindHandleType(Flowchart.Types.Flows, { patch: [PatchType(Flowchart.Types.Flows)] });

/** The record in memory, and the dataset cache it writes through. */
export interface RecordHarness {
    /** The record API in memory: its commits. */
    readonly memory: RecordApi;
    /** The dataset cache its record is read through. */
    readonly cache: ReactiveDatasetCache;
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
 * records given, each with a patch mutation of its own.
 *
 * @param initial - The record's flows
 * @param others - The other records, each with its patch mutation
 * @returns The harness
 */
export function recordHarness(initial: Flows, others: readonly { readonly name: string; readonly type: EastType; readonly initial: unknown }[] = []): RecordHarness {
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
    initializeRecordApi(memory, cache, WORKSPACE);
    return { memory, cache };
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
