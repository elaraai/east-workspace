/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar examples through the real dispatcher, shared runtime and checked record patches. */
import { beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { PatchType, applyFor, decodeBeast2For, encodeBeast2For, variant, type EastIR, type EastType, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi, type DatasetApi, type RecordApi } from "../platform/index.js";
import { act, isolateRuns } from "../test-runs.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";
export { act };
export const WORKSPACE = "calendar-test";
export const RECORDS = [ex.calendarMachines, ex.calendarPeople, ex.calendarJobs, ex.calendarServices, ex.calendarShifts,
    ex.calendarJobTemplates, ex.calendarServiceTemplates, ex.calendarShiftTemplates, ex.calendarAppointments];
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

export function calendarHarness() {
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
            if (this.hasAttribute("data-calendar-main")) return { x: 0, y: 0, top: 0, left: 0, right: mainWidth, bottom: 700, width: mainWidth, height: 700, toJSON() {} };
            return realRect.call(this);
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
export async function width(value: number) { await act(async () => { mainWidth = value; for (const observe of observers) observe(); }); await settle(); }
export const programOf = (example: { fn: { toIR(): unknown } }): (() => ValueTypeOf<typeof UIComponentType>) => (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
export function mount(example: { fn: { toIR(): unknown } }, storageKey = "calendar-test"): RenderResult {
    const program = programOf(example);
    return render(<ChakraProvider value={system}><DragLayerProvider><EastChakraComponent value={program()} storageKey={storageKey} /></DragLayerProvider></ChakraProvider>);
}
export const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`)!;
export const event = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind, key }))}]`)!;
export const card = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind, key }))}]`)!;
