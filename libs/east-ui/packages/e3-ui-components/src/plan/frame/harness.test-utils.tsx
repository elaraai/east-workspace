/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's DOM test harness over the print works' examples (#1192, #1193,
 * #1195, #1197): the record runtime a surface installs, over every record of
 * the examples' held in memory — each patch door applying its patch with
 * East's own checks, each state it commits named by its content's hash, as e3
 * names it, so a Save's revision is the one the paged reads move to — and
 * their inputs' declared values, every whole read of a dataset counted; the paging service
 * over the records the print works' `Slice.bindRecords` pages through their
 * indexes (#1344), each index evaluated by its own East key function, as e3
 * serves it; what jsdom lacks; and the selectors a test finds the frame's
 * regions, the canvas's rows and the events' elements by. A test file calls
 * {@link planHarness} once, at its top, and mounts Plans as a surface does:
 * through the dispatcher, under the page's drag layer when its cards drag.
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
import { PatchType, applyFor, encodeBeast2For, printFor, variant, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import {
    ReactiveDatasetCache, clearPagedApi, createInMemoryRecordApi, datasetCacheKey, defaultPagedRuntime, initializePagedApi, initializeReactiveDatasetCache,
    initializeRecordApi,
    type DatasetApi, type PagedApi, type RecordApi,
} from "../../platform/index.js";
import { countWholeReads, recordPaging, servedIndex, type WholeReads } from "../../platform/record-paging.test-utils.js";
import { act, isolateRuns } from "../../test-runs.test-utils.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
// The canvas is an extension: its renderer registers as it loads.
import "../index.js";

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
export const WORKSPACE = "plan-test";

/** A record a test commits to: its name and its type. */
interface CommittedRecord {
    name: string;
    type: Parameters<typeof encodeBeast2For>[0];
}

/** What a test reads and writes through: the records in memory, the cache over them, and the paging service. */
export interface PlanHarness {
    /** The records' API: their patch doors and their history. */
    memory: RecordApi;
    /** The datasets the records are read through. */
    cache: ReactiveDatasetCache;
    /** The paging service over the records the rail pages: its API, and each request it was sent, as `<path> <op> <where>`. */
    paging: { api: PagedApi; requests: string[] };
    /** Each dataset read whole, by its path's text, in order — but the record server's own, as it applies a patch, and the paging service's. */
    wholeReads: string[];
    /** The cache's own read, uncounted: what the paging service reads a record by. */
    raw: WholeReads["raw"];
    /** A records' API as e3's server answers: its writes' own reads uncounted, each state it commits named by its content's hash. */
    serve: WholeReads["serve"];
    /**
     * Commits a record's state, as another writer would: its dataset's new
     * bytes; then lets the reads and the renders settle.
     *
     * @param record - The record
     * @param state - Its new state
     */
    commit(record: CommittedRecord, state: unknown): Promise<void>;
}

/** A record of the examples', in memory, its patch door applying each patch with East's checks. */
function patchable<T extends { name: string; type: Parameters<typeof applyFor>[0]; default?: unknown }>(record: T) {
    const applyPatch = applyFor(record.type);
    return {
        name: record.name, stateType: record.type, initial: record.default!,
        mutations: [{ name: "patch", argTypes: [PatchType(record.type)], reduce: (state: unknown, patch: unknown) => applyPatch(state as never, patch as never) }],
    };
}

/** A record of the examples' a Plan only reads — a templates list, read whole and through the rail's indexes: its declared state, no mutation. */
function readOnly<T extends { name: string; type: Parameters<typeof applyFor>[0]; default?: unknown }>(record: T) {
    return { name: record.name, stateType: record.type, initial: record.default!, mutations: [] };
}

/** Each record the print works' rail pages, with every index it reads it through (#1344). */
const PAGED = [
    { record: ex.planPrintJobs, indexes: [ex.planPrintJobsByTime, ex.planPrintJobsByStockTime] },
    { record: ex.planPrintShifts, indexes: [ex.planPrintShiftsByTime] },
    { record: ex.planPrintPresses, indexes: [ex.planPrintPressesByHall] },
    { record: ex.planPrintCustomers, indexes: [ex.planPrintCustomersByDistrict] },
    { record: ex.planPrintJobTemplates, indexes: [ex.planPrintJobTemplatesByGroup] },
    { record: ex.planPrintStopTemplates, indexes: [ex.planPrintStopTemplatesByGroup] },
    { record: ex.planPrintShiftTemplates, indexes: [ex.planPrintShiftTemplatesByGroup] },
    { record: ex.planPrintPlatesTemplates, indexes: [ex.planPrintPlatesTemplatesByGroup] },
    { record: ex.planPrintBindingTemplates, indexes: [ex.planPrintBindingTemplatesByGroup] },
    { record: ex.planPrintDeliveryTemplates, indexes: [ex.planPrintDeliveryTemplatesByGroup] },
] as const;

/** An input of the examples', its declared value in the cache. */
function seed(cache: ReactiveDatasetCache, input: { path: Parameters<ReactiveDatasetCache["write"]>[1]; type: Parameters<typeof encodeBeast2For>[0]; source?: { type: string; value?: unknown } }) {
    if (input.source?.type !== "value") throw new Error("the input declares no value");
    void cache.write(WORKSPACE, input.path, encodeBeast2For(input.type)(input.source.value as never));
}

/**
 * Installs the harness around each test of the file: a fresh store, the
 * examples' records in memory and their inputs' values; after each, the DOM
 * and the viewer's storage are cleared. Each test is a run of its own
 * (#1280): once it ends — its afterEach hooks having unmounted what it
 * mounted — the work it left in flight settles before the next test begins,
 * and its body, if its timeout abandoned it, starts nothing more.
 *
 * @returns The records, the cache and a commit — each test's own, set before it runs
 */
export function planHarness(): PlanHarness {
    isolateRuns();
    const harness = {
        async commit(record: CommittedRecord, state: unknown) {
            await act(async () => {
                await harness.cache.write(WORKSPACE, [variant("field", "records"), variant("field", record.name)], encodeBeast2For(record.type)(state as never));
            });
            await settle();
        },
    } as PlanHarness;
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
        harness.cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
        harness.cache.setScheduler((notify) => queueMicrotask(notify));
        initializeReactiveDatasetCache(harness.cache);
        // The record server as e3's answers: each state it commits named by its content's hash — the revision the paged
        // reads move to, so a Save confirms at the revision its reads reach (#1344) — and every whole read counted.
        const reads = countWholeReads(harness.cache);
        harness.wholeReads = reads.paths;
        harness.raw = reads.raw;
        harness.serve = reads.serve;
        harness.memory = reads.serve(createInMemoryRecordApi(harness.cache, WORKSPACE, [
            patchable(ex.planPrintPresses), patchable(ex.planPrintCrews), patchable(ex.planPrintJobs), patchable(ex.planPrintStops),
            patchable(ex.planPrintShifts), patchable(ex.planPrintCustomers), patchable(ex.planEventJobs), patchable(ex.planLinkJobs),
            patchable(ex.planLinkSetters), patchable(ex.planLinkLines), patchable(ex.planLinkBays), patchable(ex.planLinkPlates),
            patchable(ex.planLinkCaseJobs), patchable(ex.planLinkBindings), patchable(ex.planLinkDeliveries),
            patchable(ex.planPrintBindery), patchable(ex.planPrintVans), patchable(ex.planPrintPlates),
            patchable(ex.planPrintBindings), patchable(ex.planPrintDeliveries),
            readOnly(ex.planPrintJobTemplates), readOnly(ex.planPrintStopTemplates), readOnly(ex.planPrintShiftTemplates),
            readOnly(ex.planPrintPlatesTemplates), readOnly(ex.planPrintBindingTemplates), readOnly(ex.planPrintDeliveryTemplates),
        ]));
        initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
        // The rail's sources (#1344): each record paged through its indexes, as e3 serves them.
        harness.paging = recordPaging(harness.cache, reads.raw,
            PAGED.map(({ record, indexes }) => ({ path: record.path, type: record.type, indexes: indexes.map(servedIndex) })));
        initializePagedApi(harness.paging.api, WORKSPACE);
        seed(harness.cache, ex.planPrintUtilisation);
        seed(harness.cache, ex.planPrintOutput);
        seed(harness.cache, ex.planLinkStock);
    });
    afterEach(() => {
        cleanup();
        clearPagedApi();
        defaultPagedRuntime.clear();
        localStorage.clear();
    });
    return harness;
}

/** Lets the records' reads, the canvas's windows and the renders settle. */
export async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** A compiled Plan: a program that returns its UI component. */
export type PlanProgram = () => ValueTypeOf<typeof UIComponentType>;

/**
 * An example's program.
 *
 * @param example - The example
 * @returns Its program, compiled — its `fn` erases its output type at the package boundary; the Plan's are UI components
 */
export const programOf = (example: { fn: { toIR(): unknown } }): PlanProgram =>
    (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());

/** How a test mounts a Plan: under the page's drag layer, as a surface whose cards drag does. */
export interface MountOptions {
    /** Mount the page's drag layer around it. */
    drag?: boolean | undefined;
}

/** The page around a Plan: the theme, and the drag layer when it drags. */
function page(children: ReactNode, options: MountOptions): ReactNode {
    return <ChakraProvider value={system}>{options.drag === true ? <DragLayerProvider>{children}</DragLayerProvider> : children}</ChakraProvider>;
}

/**
 * Mounts a compiled Plan through the dispatcher, as a surface does.
 *
 * @param program - The Plan's program
 * @param options - Whether the page holds a drag layer
 * @returns The render
 */
export function mount(program: PlanProgram, options: MountOptions = {}): RenderResult {
    return render(page(<EastChakraComponent value={program()} storageKey="plan" />, options));
}

/**
 * A region of the Plan's frame.
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

/**
 * A row's id, by its series and path.
 *
 * @param series - Its series: `<kind>.<draw>` for a resource's row
 * @param path - Its path: its group and its resource's key, for a resource's
 * @returns The id
 */
export const entry = (series: string, ...path: string[]): PlanRowId => variant("entry", { series, path }) as PlanRowId;

/**
 * The selector of a row, by its id — `data-plan-row` holds its id's text.
 *
 * @param id - The row's id
 * @returns The selector
 */
export const rowAt = (id: PlanRowId) => `[data-plan-row=${JSON.stringify(rowKeyOf(id))}]`;

const printRef = printFor(ScheduleEventRefType);

/**
 * An event's element key: its event, as East prints a `Schedule.Types.EventRef`.
 *
 * @param kind - The event's kind
 * @param key - The event's key in its record
 * @returns The key its elements carry
 */
export const elementKey = (kind: string, key: string) => printRef({ kind, key });

/**
 * The selector of an event's element, by the attribute its draw carries.
 *
 * @param attr - `data-run` for a bar, `data-chip` for a chip, `data-event` for a tile, `data-mark` for a mark
 * @param kind - The event's kind
 * @param key - The event's key in its record
 * @returns The selector
 */
export const el = (attr: "data-run" | "data-chip" | "data-event" | "data-mark", kind: string, key: string) =>
    `[${attr}=${JSON.stringify(elementKey(kind, key))}]`;
