/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An e3-ui example mounted on e3 itself (#1375), as the showcase mounts its
 * examples: e3-web in this process (`e3-web.test-utils.ts`), the example under
 * `E3Provider` over the test's workspace and `ReactiveDatasetProvider`, which
 * installs the runtimes `Data.bind`, `Data.bindPaged`, `Func.bind` and
 * `Record.bind` resolve through, what the example reads whole (its manifest's
 * paths) loaded before it renders, as the showcase's gate and a UI task's
 * preview load it.
 *
 * {@link e3Harness} gives a file its e3 — started once, a workspace of its own
 * per test — and each test a run of its own (`test-runs.test-utils.ts`).
 * {@link settle} waits until no request to e3 is in flight and React has
 * flushed, again until both hold at once. jsdom lays nothing out, so the
 * harness measures what the builders' virtualizers and frames read: main and
 * a Library's viewport, their rows, and the widths a resize sets
 * ({@link width}).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup, render, waitFor, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import type { EastIR, EastType, ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { deriveManifest } from "@elaraai/e3-ui";
import type { TreePath } from "@elaraai/e3-types";
import {
    E3Provider, MemoryStagedAdapter, ReactiveDatasetLoader, ReactiveDatasetProvider, StagedStore, initializeStagedStore, useReactiveDatasetCache,
    type ReactiveDatasetCacheInterface,
} from "./platform/index.js";
import type { RecordHistoryResult } from "@elaraai/e3-api-client";
import {
    patchRecord, readDataset, recordHistory, runDataflow, startTestE3, writeDataset, type E3Dataset, type E3Record, type E3Request, type TestE3,
} from "./e3-web.test-utils.js";
import { act, isolateRuns } from "./test-runs.test-utils.js";

export { act };

// e3's repositories are in memory, so the edits staged against it are kept in
// memory too, as the showcase keeps them; IndexedDB would outlive the test's e3.
initializeStagedStore(new StagedStore(new MemoryStagedAdapter()));

/** How often what a mounted example reads is polled while it shows: as often as the showcase and a UI task's preview poll theirs. */
const EXAMPLE_POLL_MS = 1000;

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

/** A compiled UI program: what renders. */
export type UIProgram = () => ValueTypeOf<typeof UIComponentType>;

/** An e3-ui example, as its module exports it. */
export interface Example {
    /** Its East function. */
    readonly fn: { toIR(): unknown };
}

/** An example's IR: what it compiles to, and what its manifest is derived from. */
const irOf = (example: Example): EastIR<[], typeof UIComponentType> => example.fn.toIR() as EastIR<[], typeof UIComponentType>;

/**
 * An example's program, compiled with every platform function registered.
 *
 * @param example - The example
 * @returns Its program
 */
export const programOf = (example: Example): UIProgram => irOf(example).compile(getRegisteredPlatformImplementations());

/** How {@link E3Harness.mount} mounts an example. */
export interface MountOptions {
    /** The program to render in place of the example's own: a counted one (`builds.test-utils.ts`). Its reads are the example's. */
    readonly program?: UIProgram;
    /**
     * What renders in place of the example's program, under its providers once what it reads whole has loaded:
     * a component a test renders itself — a payload through its renderer, say — the example then naming what it
     * reads (`{ fn }`, the function that builds the payload).
     */
    readonly view?: ReactNode;
    /** Where its view and sessions are kept; `builder-test` unless given. */
    readonly storageKey?: string;
    /** The workspace it reads; the test's own unless given. */
    readonly workspace?: string;
    /** Whether the page holds a drag layer around it, as a surface whose cards drag does: `true` unless given. */
    readonly drag?: boolean;
    /** What the page holds the surface in, inside the theme: a locale (`I18nProvider`), say. Nothing unless given. */
    readonly wrap?: (surface: ReactNode) => ReactNode;
}

/** How {@link e3Harness} lays out what jsdom cannot. */
export interface HarnessOptions {
    /** The attribute of the builder's main area (`data-calendar-main`), which the measuring stubs measure as the viewport. */
    readonly main?: string;
    /**
     * Whether to measure the builders' viewports and rows as a browser would lay them: main and a Library's
     * viewport, their virtual rows, and the widths {@link width} sets. `true` unless given; a component that
     * measures nothing of them (the Plan's canvas) gives `false`.
     */
    readonly measure?: boolean;
}

/** A file's e3, and what each test does with it: see {@link e3Harness}. */
export interface E3Harness {
    /** e3 under test: its fetch, its request log, its holds and faults. */
    readonly e3: TestE3;
    /** The test's own workspace: a fresh copy of the deployed package. */
    readonly workspace: string;
    /**
     * Mounts an example as the showcase does, and settles once what it reads
     * whole has loaded, it has rendered and a poll has told it e3's status of
     * what it reads (the run that status brings, the showcase's a second in).
     *
     * @param example - The example
     * @param options - A program in its place, where its sessions are kept, the workspace it reads
     * @returns What Testing Library rendered
     */
    mount(example: Example, options?: MountOptions): Promise<RenderResult>;
    /**
     * Installs the runtimes over the test's workspace, as a mounted example's
     * providers do, with what a program reads whole loaded and its status
     * heard: for a test that evaluates a program, or renders a hook, outside a
     * mounted example.
     *
     * @param example - What the program reads: an example, or a program's own East function as one (`{ fn }`)
     * @returns What unmounts them
     */
    install(example: Example): Promise<() => void>;
    /**
     * What e3 holds of a dataset or a record now, in the test's workspace.
     *
     * @param dataset - The dataset or record
     * @returns Its value
     */
    read<T extends EastType>(dataset: E3Dataset<T>): Promise<ValueTypeOf<T>>;
    /**
     * Commits a record's new state as another session would, then settles.
     *
     * @param record - The record, which declares a patch mutation
     * @param next - Its new state
     */
    patch<T extends EastType>(record: E3Record<T>, next: ValueTypeOf<T>): Promise<void>;
    /**
     * A Save another session's write overtakes: the record's next mutation is
     * held on its way to e3 while the other session commits the record's new
     * state, then let go — so e3 checks the Save against the record as it has
     * moved, and what is mounted hears of the other write only from the Save's
     * answer. Then settles.
     *
     * @param record - The record both write, which declares a patch mutation
     * @param save - What sends the Save: a press of its button, say
     * @param next - The record's state as the other session leaves it, from its state as the Save goes
     */
    race<T extends EastType>(record: E3Record<T>, save: () => void, next: (now: ValueTypeOf<T>) => ValueTypeOf<T>): Promise<void>;
    /**
     * Writes a dataset as another session would, then settles.
     *
     * @param dataset - The dataset
     * @param value - Its new value
     */
    write<T extends EastType>(dataset: E3Dataset<T>, value: ValueTypeOf<T>): Promise<void>;
    /**
     * A record's commits in the test's workspace, newest first.
     *
     * @param record - The record
     * @returns Its history
     */
    history(record: { readonly name: string }): Promise<RecordHistoryResult>;
    /**
     * Runs the test's workspace's dataflow, as another session's run would,
     * then lets the mounted examples see what it wrote.
     */
    run(): Promise<void>;
    /**
     * The requests made of the test's workspace so far.
     *
     * @param kind - Only those of this kind (`read`, `find`, `page`, …)
     * @param of - Only those naming this dataset (`records.jobs`) or record (`jobs`)
     * @returns The requests, in order
     */
    requests(kind?: E3Request["kind"], of?: string): E3Request[];
}

/** The file's harness, which {@link settle} waits on and {@link E3Surface} renders over. */
let current: { e3: TestE3 | undefined; workspace: string | undefined } | undefined;

/** The file's harness, once it has called {@link e3Harness}: what a helper mounting outside an example drives. */
let fileHarness: E3Harness | undefined;

/**
 * The harness the file called {@link e3Harness} for: what a helper that
 * mounts a component of its own reads, writes and holds through.
 *
 * @returns The harness
 * @throws {Error} When the file has called no e3Harness
 */
export function currentHarness(): E3Harness {
    if (fileHarness === undefined) throw new Error("the file calls no e3Harness: call it once, at the file's top");
    return fileHarness;
}

/** The dataset caches of the examples mounted now: another session's change reaches each at once ({@link E3Harness.patch}). */
const mountedCaches = new Set<ReactiveDatasetCacheInterface>();

/**
 * Lets every mounted example's cache see what another session changed, as
 * its next poll would: one poll of the workspace's status now.
 *
 * @param workspace - The workspace changed
 */
async function refreshMounted(workspace: string): Promise<void> {
    await act(async () => { await Promise.all([...mountedCaches].map((cache) => cache.refresh(workspace))); });
    await settle();
}

/**
 * Lets what was just mounted hear e3's status of what it reads, as the
 * showcase's first poll a second in does: the first status a poll reports of
 * a dataset is news to the cache, which tells every reader of it — a Reactive
 * body reading it runs again, its value unchanged (`dataset-store.ts`). Heard
 * before the test begins, that run lands nowhere in what the test does or
 * counts; a later poll reports nothing new unless e3's data moves.
 *
 * @param workspace - The workspace mounted
 */
const heardStatus = (workspace: string): Promise<void> => refreshMounted(workspace);

/**
 * Gives a test file its e3, and each test a workspace of its own.
 *
 * Called as the file is collected. Before the file's tests, e3-web starts
 * with the package of the given example modules deployed
 * (`startTestE3`); before each, the test gets a fresh copy of the deployed
 * workspace, a store of its own and the measuring stubs; after each, its
 * holds and faults stop, what it mounted unmounts and its requests settle.
 *
 * @param modules - Each e3-ui example module the file mounts, by its key under e3-ui's `test/` (`calendar/calendar-records`), as the file imports it
 * @param options - The builder's main area, and whether to measure it
 * @returns The harness
 */
export function e3Harness(modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>, options: HarnessOptions = {}): E3Harness {
    const mainAttribute = options.main ?? "data-builder-main";
    isolateRuns();
    const state: { e3: TestE3 | undefined; workspace: string | undefined } = { e3: undefined, workspace: undefined };
    current = state;
    const e3 = (): TestE3 => {
        if (state.e3 === undefined) throw new Error("e3 has not started: the harness's beforeAll has not run");
        return state.e3;
    };
    const workspace = (): string => {
        if (state.workspace === undefined) throw new Error("the test has no workspace: the harness's beforeEach has not run");
        return state.workspace;
    };
    // The first deploy pays for every record's initial value and index.
    beforeAll(async () => { state.e3 = await startTestE3(modules); }, 120_000);
    afterAll(() => { state.e3?.close(); state.e3 = undefined; });
    beforeEach(async () => {
        StateRuntime.initializeStore(new UIStore());
        mainWidth = 900;
        state.workspace = await e3().workspace();
        e3().reset();
        if (options.measure === false) return;
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
    });
    afterEach(async () => {
        // A request a hold parks goes on, so what the test mounted can let it go.
        state.e3?.reset();
        cleanup();
        localStorage.clear();
        vi.restoreAllMocks();
        observers.clear();
        await state.e3?.idle();
        state.workspace = undefined;
    });
    const harness: E3Harness = {
        get e3() { return e3(); },
        get workspace() { return workspace(); },
        async mount(example, mountOptions = {}) {
            const ws = mountOptions.workspace ?? workspace();
            const surface = (
                <E3Provider config={{ apiUrl: e3().apiUrl, fetch: e3().fetch, repo: e3().repo, workspace: ws, token: null }}>
                    <ReactiveDatasetProvider>
                        <ExampleReads example={example} workspace={ws}>
                            {mountOptions.view ?? <Program example={example} program={mountOptions.program} storageKey={mountOptions.storageKey ?? "builder-test"} />}
                        </ExampleReads>
                    </ReactiveDatasetProvider>
                </E3Provider>
            );
            const page = mountOptions.drag === false ? surface : <DragLayerProvider>{surface}</DragLayerProvider>;
            const mounted = render(<ChakraProvider value={system}>{mountOptions.wrap === undefined ? page : mountOptions.wrap(page)}</ChakraProvider>);
            await waitFor(() => {
                if (mounted.container.querySelector("[data-e3-reads=loading]") !== null) throw new Error("what the example reads has not loaded");
                if (mounted.container.querySelector("[data-e3-reads=failed]") !== null) throw new Error(`what the example reads did not load: ${mounted.container.textContent ?? ""}`);
            }, { timeout: 30_000 });
            await settle();
            await heardStatus(ws);
            return mounted;
        },
        async install(example) {
            const ws = workspace();
            const mounted = render(
                <E3Provider config={{ apiUrl: e3().apiUrl, fetch: e3().fetch, repo: e3().repo, workspace: ws, token: null }}>
                    <ReactiveDatasetProvider>
                        <ExampleReads example={example} workspace={ws}><div data-e3-reads="loaded" /></ExampleReads>
                    </ReactiveDatasetProvider>
                </E3Provider>);
            await waitFor(() => {
                if (mounted.container.querySelector("[data-e3-reads=failed]") !== null) throw new Error(`what the program reads did not load: ${mounted.container.textContent ?? ""}`);
                if (mounted.container.querySelector("[data-e3-reads=loaded]") === null) throw new Error("what the program reads has not loaded");
            }, { timeout: 30_000 });
            await settle();
            await heardStatus(ws);
            return () => mounted.unmount();
        },
        read: (dataset) => readDataset(e3(), workspace(), dataset),
        async patch(record, next) {
            await patchRecord(e3(), workspace(), record, next);
            await refreshMounted(workspace());
        },
        async race(record, save, next) {
            const saving = e3().hold((request) => request.kind === "mutate" && request.record === record.name);
            await act(async () => { save(); });
            await saving.holding;
            await patchRecord(e3(), workspace(), record, next(await readDataset(e3(), workspace(), record)));
            await act(async () => { saving.release(); });
            await settle();
        },
        async write(dataset, value) {
            await writeDataset(e3(), workspace(), dataset, value);
            await refreshMounted(workspace());
        },
        history: (record) => recordHistory(e3(), workspace(), record),
        async run() {
            await runDataflow(e3(), workspace());
            await refreshMounted(workspace());
        },
        requests(kind, of) {
            const ws = workspace();
            return e3().requests.filter((request) => request.workspace === ws
                && (kind === undefined || request.kind === kind)
                && (of === undefined || request.dataset === of || request.record === of));
        },
    };
    fileHarness = harness;
    return harness;
}

/** What an example reads whole, loaded before it renders and polled while it shows, as the showcase's gate loads and polls it. */
function ExampleReads({ example, workspace, children }: { example: Example; workspace: string; children: ReactNode }) {
    const datasets = useMemo(() => deriveManifest({ toIR: () => irOf(example) }).paths.map((path) => ({ workspace, path })), [example, workspace]);
    return (
        <ReactiveDatasetLoader datasets={datasets} fallback={<div data-e3-reads="loading" />}
            onError={(error) => <div data-e3-reads="failed">{error.message}</div>}>
            <PolledReads datasets={datasets} />
            {children}
        </ReactiveDatasetLoader>
    );
}

/**
 * What a component a test renders itself reads e3 under — a Plan canvas
 * mounted outside an example, say: `E3Provider` over the file's e3 and the
 * test's workspace, and `ReactiveDatasetProvider`, which installs the runtimes
 * `Data.bind`, `Data.bindPaged`, `Func.bind` and `Record.bind` resolve
 * through. Its children render once the runtimes are installed, and another
 * session's change reaches its cache at once ({@link E3Harness.patch}).
 *
 * @param props - What renders under it
 * @returns The providers over the children
 * @throws {Error} When the file has no e3 harness, or the test no workspace yet
 */
export function E3Surface({ children }: { children: ReactNode }) {
    const e3 = current?.e3;
    const workspace = current?.workspace;
    if (e3 === undefined || workspace === undefined) throw new Error("E3Surface renders under a file's e3Harness, inside a test");
    return (
        <E3Provider config={{ apiUrl: e3.apiUrl, fetch: e3.fetch, repo: e3.repo, workspace, token: null }}>
            <ReactiveDatasetProvider>
                <PolledReads datasets={NO_READS} />
                {children}
            </ReactiveDatasetProvider>
        </E3Provider>
    );
}

/** No dataset read whole. */
const NO_READS: readonly { workspace: string; path: TreePath }[] = [];

/** Polls what an example reads for as long as it shows, and keeps its cache where another session's change reaches it. */
function PolledReads({ datasets }: { datasets: readonly { workspace: string; path: TreePath }[] }) {
    const cache = useReactiveDatasetCache();
    useLayoutEffect(() => {
        for (const { workspace, path } of datasets) cache.setRefetchInterval(workspace, path, EXAMPLE_POLL_MS);
        mountedCaches.add(cache);
        return () => {
            mountedCaches.delete(cache);
            for (const { workspace, path } of datasets) cache.clearRefetchInterval(workspace, path);
        };
    }, [cache, datasets]);
    return null;
}

/** The example's program, compiled once its reads have loaded, rendered through the dispatcher. */
function Program({ example, program, storageKey }: { example: Example; program: UIProgram | undefined; storageKey: string }) {
    const value = useMemo(() => (program ?? programOf(example))(), [example, program]);
    return <EastChakraComponent value={value} storageKey={storageKey} />;
}

/**
 * Waits until React has flushed and no request to e3 is in flight — those a
 * hold parks aside — again until both hold at once with no request started
 * meanwhile. Outside a harness's file, it flushes React alone.
 */
export async function settle(): Promise<void> {
    for (;;) {
        const e3 = current?.e3;
        const before = e3?.started() ?? 0;
        await act(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setTimeout(resolve, 0)); });
        if (e3 === undefined) return;
        await e3.idle();
        await act(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setTimeout(resolve, 0)); });
        if (e3.started() === before) return;
    }
}

/**
 * Lays main out at a width, as a resize does, and settles.
 *
 * @param value - Main's width, in pixels
 */
export async function width(value: number): Promise<void> {
    await act(async () => { mainWidth = value; for (const observe of [...observers]) observe(); });
    await settle();
}

/**
 * A builder frame's slot.
 *
 * @param container - What the example rendered into
 * @param name - The slot (`toolbar`, `main`, `start`, `end`, `footer`)
 * @returns The slot's element
 */
export const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`)!;
