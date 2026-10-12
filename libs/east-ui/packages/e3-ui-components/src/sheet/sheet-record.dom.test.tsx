/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Sheet over the host's rows, read from one entry of an e3 record (#1180):
 * the configurator's sheet, its rows `data` read with `Record.bind`, and Save
 * handing the checked batch to `onApply` — `Record.onApply` over the entry's
 * rows, which commits it through the record's patch door. The example itself
 * is mounted, in its frame (#1216), under the record runtime a surface
 * installs; the record is the in-memory stand-in, whose patch door applies
 * each patch with East's own checks.
 */

import { test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For, equalFor, none, some, variant, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
import { boundFrame } from "./frame.test-utils.js";
// The Sheet is an extension: its renderer registers as it loads.
import "./frame/index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `matchMedia`; the configurator's controls ask it whether the viewer wants less motion.
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});

const WORKSPACE = "sheet-record-test";
const PLANS = ex.sheetVariantsPlans;
type Plans = ValueTypeOf<typeof PLANS.type>;

let memory: RecordApi;
let cache: ReactiveDatasetCache;
let restoreFrame: () => void = () => {};

beforeEach(() => {
    StateRuntime.initializeStore(new UIStore());
    restoreFrame = boundFrame(2000);
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
    restoreFrame();
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

test("an edited task, saved, is one commit through the record's patch door, and the drafts retire", async () => {
    // An example's `fn` erases its output type at the package boundary; the
    // Sheet's examples are UI components (as the showcase's `exampleIr` narrows).
    const program = (ex.sheetVariants.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={program()} storageKey="sheet-record" />
        </ChakraProvider>,
    );
    await settle();
    const row = () => utils.container.querySelector('[data-slot="row"]')!;
    const task = () => row().querySelector('[data-key="task"]')!;
    expect(task().textContent).toContain("Routing");

    fireEvent.doubleClick(task());
    await settle();
    const input = utils.container.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: "Spraying" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    const save = utils.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(row().hasAttribute("data-draft")).toBe(true);
    await act(async () => {
        fireEvent.mouseDown(save, { button: 0 });
        fireEvent.click(save);
    });
    await settle();

    // The record holds the edit, and nothing else of it moved — one patch commit.
    const expected = new SortedMap([["week", { jobs: [
        { id: "j1", start: some(new Date("2026-02-16T00:00:00Z")), task: "Spraying", qty: some(1200.0), notes: "Nest the C-18 panels" },
        { id: "j2", start: some(new Date("2026-03-09T00:00:00Z")), task: "Spraying", qty: some(250.0), notes: "" },
        { id: "j3", start: none, task: "Wrapping", qty: none, notes: "" },
    ] }]], compareFor(StringType));
    expect(equalFor(PLANS.type)(readRecord(), expected)).toBe(true);
    const { commits } = await memory.history(WORKSPACE, PLANS.name, undefined);
    expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);

    // The drafts retired against the rows the record read back: no error, Save
    // off, and the cell shows the record's task, no longer a draft over it.
    expect(utils.queryByRole("alert")).toBeNull();
    expect((utils.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(task().textContent).toContain("Spraying");
    expect(row().hasAttribute("data-draft")).toBe(false);
});
