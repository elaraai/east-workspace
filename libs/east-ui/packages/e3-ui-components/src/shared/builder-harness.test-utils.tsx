/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared builder examples through the dispatcher, runtime and checked record patches. */
import { beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { PatchType, applyFor, decodeBeast2For, encodeBeast2For, variant, type EastIR, type EastType, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi, type DatasetApi, type RecordApi } from "../platform/index.js";
import { act, isolateRuns } from "../test-runs.test-utils.js";
export { act };
const observers = new Set<() => void>();
let mainWidth = 900;
class ResizeObserverStub {
    readonly elements = new Set<Element>();
    readonly notify = () => this.callback([...this.elements].map(target => {
        const rect = target.getBoundingClientRect();
        return { target, contentRect: rect, borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }], contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }], devicePixelContentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }] } as ResizeObserverEntry;
    }), this as unknown as ResizeObserver);
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this.notify); }
    observe(element: Element) { this.elements.add(element); }
    unobserve(element: Element) { this.elements.delete(element); }
    disconnect() { observers.delete(this.notify); }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
(globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= s => s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
Element.prototype.scrollTo ??= function scrollTo() {};

export function builderHarness(WORKSPACE: string, RECORDS: readonly { name: string; type: EastType; default?: unknown }[], mainAttribute: string) {
    isolateRuns();
    const harness = {} as { cache: ReactiveDatasetCache; memory: RecordApi;
        commit(record: { name: string; type: EastType }, state: unknown): Promise<void>;
        read<T extends EastType>(record: { name: string; type: T }): ValueTypeOf<T>;
    };
    harness.commit = async (record, state) => {
        await act(async () => { await harness.cache.write(WORKSPACE, [variant("field", "records"), variant("field", record.name)], encodeBeast2For(record.type)(state as never)); });
        await settle();
    };
    harness.read = record => {
        const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", record.name)]);
        if (bytes === undefined) throw new Error("record has not loaded");
        return decodeBeast2For(record.type)(bytes);
    };
    beforeEach(() => {
        StateRuntime.initializeStore(new UIStore());
        mainWidth = 900;
        const realRect = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const library = this.closest("[data-library]") !== null;
            const viewport = this.hasAttribute(mainAttribute) || this.matches("[data-virtual-rows], [data-library] [data-scrollable]");
            const row = this.hasAttribute("data-index") && (library || this.closest("[data-virtual-rows]") !== null);
            if (viewport || row) {
                const width = library ? 272 : mainWidth;
                const height = viewport ? 700 : this.querySelector("[data-roster-person-card]") ? 900 : this.querySelector("[data-roster-group]") ? 38 : 62;
                return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON() {} };
            }
            return realRect.call(this);
        });
        // Shared row/Library virtualizers read viewport offsets in jsdom.
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
            return this.matches("[data-virtual-rows], [data-library] [data-scrollable]") ? 700 : 0;
        });
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.hasAttribute("data-virtual-rows") ? mainWidth : this.matches("[data-library] [data-scrollable]") ? 272 : 0;
        });
        const store = new Map<string, Uint8Array>();
        const api: DatasetApi = {
            async get(ws, path) { const bytes = store.get(datasetCacheKey(ws, path)); if (bytes === undefined) throw new Error("missing dataset"); return { data: bytes, hash: null }; },
            async set(ws, path, value) { store.set(datasetCacheKey(ws, path), value); },
            async launchDataflow() {}, async listRoot() { return []; }, async listAt() { return []; }, async workspaceStatus() { return { datasets: [] }; },
        };
        harness.cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
        harness.cache.setScheduler(notify => queueMicrotask(notify));
        initializeReactiveDatasetCache(harness.cache);
        harness.memory = createInMemoryRecordApi(harness.cache, WORKSPACE, RECORDS.map(record => ({
            name: record.name, stateType: record.type, initial: record.default!,
            mutations: [{ name: "patch", argTypes: [PatchType(record.type)], reduce: (state: unknown, patch: unknown) => applyFor(record.type)(state as never, patch as never) }],
        })));
        initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
    });
    afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); observers.clear(); });
    return harness;
}
export async function settle() { await act(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setTimeout(resolve, 0)); }); }
export async function width(value: number) { await act(async () => { mainWidth = value; for (const observe of [...observers]) observe(); }); await settle(); }
export const programOf = (example: { fn: { toIR(): unknown } }): (() => ValueTypeOf<typeof UIComponentType>) => (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
export function mount(example: { fn: { toIR(): unknown } }, storageKey = "builder-test"): RenderResult {
    const program = programOf(example);
    return render(<ChakraProvider value={system}><DragLayerProvider><EastChakraComponent value={program()} storageKey={storageKey} /></DragLayerProvider></ChakraProvider>);
}
export const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`)!;
