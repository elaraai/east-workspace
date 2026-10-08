/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's DOM tests' shared harness (#1246, #1247): a record of flows
 * in memory, bound with its patch mutation, whose patch door applies each
 * patch with East's own checks — as an app binds one — and the flowchart over
 * it through its carrier, so a Save is a real commit; and the waits and
 * presses its tests share.
 */

import { act, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, PatchType, applyFor, decodeBeast2For, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
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
 * A record of flows in memory, bound with its patch mutation, whose patch door
 * applies each patch with East's own checks.
 *
 * @param initial - The record's flows
 * @returns The harness
 */
export function recordHarness(initial: Flows): RecordHarness {
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
    }]);
    initializeRecordApi(memory, cache, WORKSPACE);
    return { memory, cache };
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
 * The flowchart over the record, as a surface mounts it: `<Flowchart>` built
 * over the bound record, compiled, and rendered through its carrier.
 *
 * @param props - Its props beside `record`; the Flows tab listed, by default
 * @returns The render
 */
export async function mountRecord(props: object = { library: [Flowchart.library.flows()] }): Promise<RenderResult> {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const flows = $.let(recordBindPlatformFn([FlowsHandle], RECORD));
        return Flowchart({ record: flows as never, ...props });
    }))), getRegisteredPlatformImplementations()) as () => UIValue;
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={program()} storageKey="flowchart-record" />
        </ChakraProvider>,
    );
    await settle();
    return utils;
}
