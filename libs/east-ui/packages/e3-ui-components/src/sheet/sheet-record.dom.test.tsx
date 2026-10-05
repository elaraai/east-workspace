/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Sheet over one entry of an e3 record (#1180) — how e3-ui's Sheet examples
 * are bound: the rows read with `Record.bind`, and Apply committing the drafts
 * through the record's patch door, `Record.onApply` over the entry's rows. The
 * example itself is mounted, under the record runtime a surface installs; the
 * record is the in-memory stand-in, whose patch door applies each patch with
 * East's own checks.
 */

import { test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For, equalFor, variant, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
// The Sheet is an extension: its renderer registers as it loads.
import "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const WORKSPACE = "sheet-record-test";
const PLANS = ex.sheetInsertionPlans;
type Plans = ValueTypeOf<typeof PLANS.type>;

let memory: RecordApi;
let cache: ReactiveDatasetCache;

beforeEach(() => {
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
    cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    const applyPatch = applyFor(PLANS.type);
    memory = createInMemoryRecordApi(cache, WORKSPACE, [{
        name: PLANS.name, stateType: PLANS.type, initial: PLANS.default!,
        mutations: [{ name: "patch", argTypes: [PatchType(PLANS.type)], reduce: (state, patch) => applyPatch(state as never, patch as never) }],
    }]);
    initializeRecordApi(memory, cache, WORKSPACE);
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** Let the record's reads, the session, the write and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The record as it stands — what its patch door last wrote. */
function readRecord(): Plans {
    const bytes = cache.read(WORKSPACE, [variant("field", "records"), variant("field", PLANS.name)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(PLANS.type)(bytes);
}

test("an edited task, applied, is one commit through the record's patch door, and the drafts retire", async () => {
    // An example's `fn` erases its output type at the package boundary; the
    // Sheet's examples are UI components (as the showcase's `exampleIr` narrows).
    const program = (ex.sheetInsertion.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={program()} storageKey="sheet-record" />
        </ChakraProvider>,
    );
    await settle();
    const task = () => utils.container.querySelector('[data-slot="row"] [data-key="task"]')!;
    expect(task().textContent).toContain("Nest panels");

    fireEvent.doubleClick(task());
    await settle();
    const input = utils.container.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: "Nest boards" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    const apply = utils.getByRole("button", { name: "Apply changes" });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
        fireEvent.mouseDown(apply, { button: 0 });
        fireEvent.click(apply);
    });
    await settle();

    // The record holds the edit, and nothing else of it moved — one patch commit.
    const expected = new SortedMap([["week", { rows: [
        { id: "nest", task: "Nest boards", qty: 120n, createdBy: "planner" },
        { id: "inspect", task: "Inspect batches", qty: 4n, createdBy: "planner" },
        { id: "finish", task: "Finish doors", qty: 120n, createdBy: "planner" },
    ] }]], compareFor(StringType));
    expect(equalFor(PLANS.type)(readRecord(), expected)).toBe(true);
    const { commits } = await memory.history(WORKSPACE, PLANS.name, undefined);
    expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);

    // The drafts retired against the rows the record read back: no error, Apply off.
    expect(utils.queryByRole("alert")).toBeNull();
    expect((utils.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(utils.getByText(/^SAVED · /u).textContent).toBe("SAVED · Nest boards → Inspect batches → Finish doors");
});
