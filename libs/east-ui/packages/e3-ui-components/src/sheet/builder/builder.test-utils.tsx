/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sheet builder's DOM test harness (#1184, #1186): what jsdom lacks, a
 * bounded 400px frame over the grid's rows, and the record runtime a surface
 * installs, over the builder examples' records held in memory, whose patch
 * door applies each patch with East's own checks. A test file calls
 * {@link builderHarness} once, at its top, and mounts builders as a surface
 * does: under the page's drag layer when it drags (#1187).
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { beforeEach, afterEach } from "vitest";
import { act, cleanup, render, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { PatchType, applyFor, encodeBeast2For, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import type { SheetBuilderPayloadType } from "@elaraai/e3-ui/internal";
import { DragLayerProvider, EastChakraComponent, I18nProvider, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-builder";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../../platform/index.js";
import { measureRowsAsDrawn } from "../frame.test-utils.js";
// The builder is an extension: its renderer registers as it loads.
import { EastChakraSheetBuilder } from "./index.js";

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

/** The workspace the records live in. */
export const WORKSPACE = "sheet-builder-test";

/** The builder's payload, decoded. */
export type Payload = ValueTypeOf<typeof SheetBuilderPayloadType>;

/** What a test reads and writes through: the records in memory, and the cache over them. */
export interface BuilderHarness {
    /** The records' API: their patch doors and their history. */
    memory: RecordApi;
    /** The datasets the records are read through. */
    cache: ReactiveDatasetCache;
}

// ── Layout stand-ins: the grid fills main, a 400px frame over its rows ───
const VIEWPORT = 400;
const frameHeight = (el: Element): number | undefined => (el.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined);
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
};

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
 *
 * @returns The records and the cache — each test's own, set before it runs
 */
export function builderHarness(): BuilderHarness {
    const harness = {} as BuilderHarness;
    let restoreRows: () => void = () => {};
    beforeEach(() => {
        StateRuntime.initializeStore(new UIStore());
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; },
        });
        Object.defineProperty(Element.prototype, "clientHeight", {
            configurable: true, get(this: Element) { return frameHeight(this) ?? 0; },
        });
        Object.defineProperty(Element.prototype, "scrollHeight", {
            configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 10_000 : 0; },
        });
        restoreRows = measureRowsAsDrawn();
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
        harness.memory = createInMemoryRecordApi(harness.cache, WORKSPACE, [
            patchable(ex.sheetBuilderJobs), patchable(ex.sheetBuilderPlans), patchable(ex.sheetBuilderOrders), patchable(ex.sheetBuilderDays),
            patchable(ex.sheetBuilderWork),
            { name: ex.sheetBuilderMachines.name, stateType: ex.sheetBuilderMachines.type, initial: ex.sheetBuilderMachines.default!, mutations: [] },
        ]);
        initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
        // The workshop's activities: an input, its declared value.
        const activities = ex.sheetBuilderActivities;
        if (activities.source?.type !== "value") throw new Error("the activities input declares no value");
        void harness.cache.write(WORKSPACE, activities.path, encodeBeast2For(activities.type)(activities.source.value));
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        restoreRows();
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
        Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
        Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    });
    return harness;
}

/** Lets the records' reads, the session, the writes and the renders settle. */
export async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** How a test mounts a builder: under the page's drag layer, as a surface that drags does (#1187). */
export interface MountOptions {
    /** Mount the page's drag layer around it. */
    drag?: boolean | undefined;
}

/** The page around a builder: the theme, the locale, and the drag layer when it drags. */
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
 * Mounts an example of the builder's, as a surface does.
 *
 * @param example - The example
 * @param options - Whether the page holds a drag layer
 * @returns The render
 */
export function mount(example: { fn: { toIR(): unknown } }, options: MountOptions = {}): RenderResult {
    // An example's `fn` erases its output type at the package boundary; the builder's examples are UI components.
    const program = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    return render(page(<EastChakraComponent value={program()} storageKey="sheet-builder" />, options));
}

/**
 * Mounts a builder's payload as given.
 *
 * @param value - The payload
 * @param options - Whether the page holds a drag layer
 * @returns The render
 */
export function mountPayload(value: Payload, options: MountOptions = {}): RenderResult {
    return render(page(<EastChakraSheetBuilder value={value} storageKey="sheet-builder" />, options));
}

/**
 * A region of the builder's frame.
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
