/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's DOM test harness over its examples (#1184, #1186, #1216): what
 * jsdom lacks, a bounded 400px frame over the grid's rows, and the record
 * runtime a surface installs, over the examples' records held in memory,
 * whose patch door applies each patch with East's own checks — and the paging
 * service over the records an example's `Slice.bindRecords` pages through
 * their indexes (#1345), each index evaluated by its own East key function. A
 * test file calls {@link sheetHarness} once, at its top, and mounts sheets as
 * a surface does: under the page's drag layer when it drags (#1187).
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): once a test ends,
 * the work it left in flight settles before the next begins, and a body its
 * timeout abandoned starts nothing more. A test file takes `act` from here,
 * never from Testing Library.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { beforeEach, afterEach } from "vitest";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, PatchType, applyFor, encodeBeast2For, type DictType, type EastIR, type EastType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, I18nProvider, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import type { TreePath } from "@elaraai/e3-types";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, defaultPagedRuntime, initializePagedApi, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../../platform/index.js";
import { recordPaging, type PagedRecord } from "../../platform/record-paging.test-utils.js";
import { act, isolateRuns } from "../../test-runs.test-utils.js";
import { boundFrame } from "../frame.test-utils.js";
// The Sheet is an extension: its renderer registers as it loads.
import { EastChakraSheet, type SheetValue } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `matchMedia`; a Box asks it whether the viewer wants less motion.
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
// jsdom has no `CSS.escape`; a segment group's radios, and a menu's items, are found with it.
(globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

/** The `act` the harness's tests take: each scope its test's work, until it closes (#1280). */
export { act };

/** The workspace the records live in. */
export const WORKSPACE = "sheet-test";

/** The Sheet's payload, decoded. */
export type Payload = SheetValue;

/** What a test reads and writes through: the records in memory, the cache over them, and the paging service's requests. */
export interface SheetHarness {
    /** The records' API: their patch doors and their history. */
    memory: RecordApi;
    /** The datasets the records are read through. */
    cache: ReactiveDatasetCache;
    /** Each request the paging service was sent, as `<path> <op> <where>`. */
    requests: string[];
}

/** An index as an example declares it: its name, its key type, and its key function over a record's entry. */
interface ExampleIndex {
    name: string;
    keyType: EastType;
    keyFn: unknown;
    multi?: boolean;
}

/**
 * A record the paging service serves through its indexes, each index's keys
 * its own East key function's, compiled.
 *
 * @param record - The record, as the example declares it
 * @param indexes - Its indexes, as the example declares them
 * @returns What the service serves
 */
function indexed(record: { path: TreePath; type: DictType<EastType, EastType> }, indexes: readonly ExampleIndex[]): PagedRecord {
    return { path: record.path, type: record.type, indexes: indexes.map((index) => {
        const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
        return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => (index.multi === true ? keys(key, row) as Iterable<unknown> : [keys(key, row)]) };
    }) };
}

/** The frame over the grid's rows: 400px, a screenful of a dozen rows. */
const VIEWPORT = 400;

/** A record of the examples', in memory, its patch door applying each patch with East's checks. */
function patchable<T extends { name: string; type: Parameters<typeof applyFor>[0]; default?: unknown }>(record: T) {
    const applyPatch = applyFor(record.type);
    return {
        name: record.name, stateType: record.type, initial: record.default!,
        mutations: [{ name: "patch", argTypes: [PatchType(record.type)], reduce: (state: unknown, patch: unknown) => applyPatch(state as never, patch as never) }],
    };
}

/**
 * Installs the harness around each test of the file: a fresh store, the
 * layout stand-ins, the records in memory and the workshop's activities;
 * after each, the DOM, the viewer's storage and the stand-ins are cleared.
 * Each test is a run of its own (#1280): once it ends — its afterEach hooks
 * having unmounted what it mounted — the work it left in flight settles
 * before the next test begins, and its body, if its timeout abandoned it,
 * starts nothing more.
 *
 * @returns The records and the cache — each test's own, set before it runs
 */
export function sheetHarness(): SheetHarness {
    isolateRuns();
    const harness = {} as SheetHarness;
    let restoreFrame: () => void = () => {};
    beforeEach(() => {
        StateRuntime.initializeStore(new UIStore());
        restoreFrame = boundFrame(VIEWPORT);
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
        harness.cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
        harness.cache.setScheduler((notify) => queueMicrotask(notify));
        initializeReactiveDatasetCache(harness.cache);
        // The records read whole, and those read only through the rail's indexes: each its declared state, no mutation.
        const readOnly = (record: { name: string; type: Parameters<typeof applyFor>[0]; default?: unknown }) =>
            ({ name: record.name, stateType: record.type, initial: record.default!, mutations: [] });
        harness.memory = createInMemoryRecordApi(harness.cache, WORKSPACE, [
            patchable(ex.sheetJobs), patchable(ex.sheetWeekPlans), patchable(ex.sheetWorkshopOrders), patchable(ex.sheetBatchDays),
            patchable(ex.sheetLooseWork),
            readOnly(ex.sheetWorkshopMachines), readOnly(ex.sheetWorkshopOperationTemplates), readOnly(ex.sheetWorkshopOrderTemplates),
            readOnly(ex.sheetBatchStepTemplates), readOnly(ex.sheetBatchTemplates), readOnly(ex.sheetStressJobs),
        ]);
        initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
        // The rail's sources (#1345): the orders, the templates records and the stress jobs, each paged through its indexes.
        const paging = recordPaging(harness.cache, harness.cache.read.bind(harness.cache), [
            indexed(ex.sheetWorkshopOrders, [ex.sheetWorkshopOrdersByStatus, ex.sheetWorkshopOrdersByCustomer]),
            indexed(ex.sheetWorkshopOperationTemplates, [ex.sheetWorkshopOperationTemplatesByGroup]),
            indexed(ex.sheetWorkshopOrderTemplates, [ex.sheetWorkshopOrderTemplatesByGroup]),
            indexed(ex.sheetBatchStepTemplates, [ex.sheetBatchStepTemplatesByGroup]),
            indexed(ex.sheetBatchTemplates, [ex.sheetBatchTemplatesByGroup]),
            indexed(ex.sheetStressJobs, [ex.sheetStressByActivity, ex.sheetStressByStatus, ex.sheetStressByNotes]),
        ]);
        harness.requests = paging.requests;
        initializePagedApi(paging.api, WORKSPACE);
        // The workshop's activities: an input, its declared value.
        const activities = ex.sheetWorkshopActivities;
        if (activities.source?.type !== "value") throw new Error("the activities input declares no value");
        void harness.cache.write(WORKSPACE, activities.path, encodeBeast2For(activities.type)(activities.source.value));
    });
    afterEach(() => {
        cleanup();
        defaultPagedRuntime.clear();
        localStorage.clear();
        restoreFrame();
    });
    return harness;
}

/** Lets the records' reads, the session, the writes and the renders settle. */
export async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** How a test mounts a sheet: under the page's drag layer, as a surface that drags does (#1187). */
export interface MountOptions {
    /** Mount the page's drag layer around it. */
    drag?: boolean | undefined;
}

/** The page around a sheet: the theme, the locale, and the drag layer when it drags. */
function page(children: ReactNode, options: MountOptions): ReactNode {
    return (
        <ChakraProvider value={system}>
            <I18nProvider locale="en-US">
                {options.drag === true ? <DragLayerProvider>{children}</DragLayerProvider> : children}
            </I18nProvider>
        </ChakraProvider>
    );
}

/**
 * Mounts an example of the Sheet's, as a surface does.
 *
 * @param example - The example
 * @param options - Whether the page holds a drag layer
 * @returns The render
 */
export function mount(example: { fn: { toIR(): unknown } }, options: MountOptions = {}): RenderResult {
    // An example's `fn` erases its output type at the package boundary; the Sheet's examples are UI components.
    const program = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    return render(page(<EastChakraComponent value={program()} storageKey="sheet" />, options));
}

/**
 * Mounts a sheet's payload as given.
 *
 * @param value - The payload
 * @param options - Whether the page holds a drag layer
 * @returns The render
 */
export function mountPayload(value: Payload, options: MountOptions = {}): RenderResult {
    return render(page(<EastChakraSheet value={value} storageKey="sheet" />, options));
}

/**
 * A region of the sheet's frame.
 *
 * @param container - The render's container
 * @param name - The region: `toolbar`, `banners`, `start`, `main`, `end` or `footer`
 * @returns Its element, if the frame draws it
 */
export const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`);

/**
 * A pane's tabs, as they read.
 *
 * @param pane - The pane's region
 * @returns Each tab's text: its name and its count
 */
export const tabs = (pane: HTMLElement) => [...pane.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
