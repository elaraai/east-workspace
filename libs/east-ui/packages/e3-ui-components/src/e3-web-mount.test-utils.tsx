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
 * preview load it — and under the showcase's plan options, so a query run over
 * a dataset of more than e3's smallest piece here is a split call
 * (`QueryPlanOptionsProvider`, {@link EXAMPLES_PIECE_MIN}).
 *
 * {@link e3Harness} gives a file its e3 — started once, a workspace of its own
 * per test — and each test a run of its own (`test-runs.test-utils.ts`).
 * {@link settle} waits until no request to e3 is in flight and React has
 * flushed, again until both hold at once. jsdom lays nothing out, so the
 * harness measures what the builders' virtualizers and frames read: main and
 * a Library's viewport, their rows, and the widths a resize sets
 * ({@link width}) — and, for a test that asks, a toolbar row too narrow for
 * what it holds, at its floor ({@link toolbarAtFloor}). {@link evaluateAgain}
 * hands every builder mounted its payload again, made anew with nothing in it
 * changed, as a page evaluated again hands it one whenever a value in it moves
 * — in a file that says its tests do ({@link evaluatesAgain}).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useReducer, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup, render, waitFor, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import type { EastIR, EastType, ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import {
    DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getExtensionEntry, getRegisteredPlatformImplementations, registerReactiveTracker, system,
} from "@elaraai/east-ui-components";
import { resetKept } from "@elaraai/east-ui-components/internal";
import { deriveManifest } from "@elaraai/e3-ui";
import type { TreePath } from "@elaraai/e3-types";
import {
    E3Provider, MemoryStagedAdapter, ReactiveDatasetLoader, ReactiveDatasetProvider, StagedStore, initializeStagedStore, useReactiveDatasetCache,
    type ReactiveDatasetCacheInterface,
} from "./platform/index.js";
import type { RecordHistoryResult } from "@elaraai/e3-api-client";
import {
    EXAMPLES_PIECE_MIN, patchRecord, readDataset, recordHistory, runDataflow, settleE3, startTestE3, workspaceRequests, writeDataset,
    type E3Dataset, type E3Record, type E3Request, type TestE3,
} from "./e3-web.test-utils.js";
import { setPagedLandingFrame } from "./platform/paged-runtime.js";
import { QueryPlanOptionsProvider } from "./query/hooks.js";
import { act, isolateRuns } from "./test-runs.test-utils.js";

export { act };

// e3's repositories are in memory, so the edits staged against it are kept in
// memory too, as the showcase keeps them; IndexedDB would outlive the test's e3.
initializeStagedStore(new StagedStore(new MemoryStagedAdapter()));

// jsdom draws no frame a test waits on: the windows a paged read lands are
// applied to their readers as the turn they land in ends, as a page applies
// them at its next frame (#1398, CL9), so an `act` sees what it read land
// before it returns, whatever the test's clock.
setPagedLandingFrame((apply) => {
    let asked = true;
    queueMicrotask(() => { if (asked) apply(); });
    return () => { asked = false; };
});

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
    /**
     * What the host holds the example in, inside e3's providers once what it reads has loaded: its own calls,
     * or plan options of its own, say — the nearest of a kind is the one the example takes. Nothing unless given.
     */
    readonly host?: (example: ReactNode) => ReactNode;
    /** The token its `E3Provider` gives e3 with every request; none unless given. */
    readonly token?: string;
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
     * @param key - The request's key, as a session's Save carries one: a record remembers its last keyed requests, and
     *   forgets the oldest as another is committed. None unless given
     */
    patch<T extends EastType>(record: E3Record<T>, next: ValueTypeOf<T>, key?: string): Promise<void>;
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
     * Two Saves at once, this one landing first: the record's next mutation
     * commits, and another session's write commits just after it, before what
     * is mounted reads its own change back — so the poll that hears its commit
     * hears the other's too, and it reads its change back beside the other's.
     * Then settles.
     *
     * @param record - The record both write, which declares a patch mutation
     * @param save - What sends the Save: a press of its button, say
     * @param next - The record's state as the other session leaves it, from its state once the Save has committed
     */
    followed<T extends EastType>(record: E3Record<T>, save: () => void, next: (now: ValueTypeOf<T>) => ValueTypeOf<T>): Promise<void>;
    /**
     * A Save whose answer comes late: the record's next mutation commits and
     * its answer is held on its way back; another session's write commits
     * after it, and what is mounted hears of that write and reads it; only
     * then does the Save's answer arrive — naming the state the Save
     * committed, which the page has passed. Then settles.
     *
     * @param record - The record both write, which declares a patch mutation
     * @param save - What sends the Save: a press of its button, say
     * @param next - The record's state as the other session leaves it, from its state once the Save has committed
     */
    late<T extends EastType>(record: E3Record<T>, save: () => void, next: (now: ValueTypeOf<T>) => ValueTypeOf<T>): Promise<void>;
    /** What is mounted polls the workspace's status now, as its next poll would, and what that leads to settles. */
    poll(): Promise<void>;
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
 * holds and faults stop, what it mounted unmounts, every spy lets go of what
 * it recorded and its requests settle.
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
        // The tab's storage goes too: a test is a tab of its own, and the drafts a test's sessions kept are not the next's.
        sessionStorage.clear();
        // What every spy recorded goes with the test, as its stub does: vitest
        // keeps each spy a file makes until the file ends, and restoring one
        // keeps its calls, each with the element it was called on — which
        // reaches the whole page the test drew, and what React drew it from.
        // The measures above, new each test, held every page the file had
        // drawn: the Calendar's records file passed 4 GiB.
        vi.clearAllMocks();
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
            // Before anything renders: a renderer swapped under a mounted builder would mount it again.
            if (handsAgain) for (const kind of BUILDERS) decodesAgain(kind);
            const view = mountOptions.view ?? <Program example={example} program={mountOptions.program} storageKey={mountOptions.storageKey ?? "builder-test"} />;
            const surface = (
                <QueryPlanOptionsProvider pieceBytes={EXAMPLES_PIECE_MIN}>
                    <E3Provider config={{ apiUrl: e3().apiUrl, fetch: e3().fetch, repo: e3().repo, workspace: ws, token: mountOptions.token ?? null }}>
                        <ReactiveDatasetProvider>
                            <ExampleReads example={example} workspace={ws}>
                                {mountOptions.host === undefined ? view : mountOptions.host(view)}
                            </ExampleReads>
                        </ReactiveDatasetProvider>
                    </E3Provider>
                </QueryPlanOptionsProvider>
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
        async patch(record, next, key) {
            await patchRecord(e3(), workspace(), record, next, "patch", key);
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
        async followed(record, save, next) {
            // The Save's answer held on its way back, its commit made; then what reads the record after it held, so the
            // other session's commit lands first.
            const answer = e3().holdAnswers((request) => request.kind === "mutate" && request.record === record.name);
            await act(async () => { save(); });
            await answer.holding;
            const reading = e3().hold((request) => request.kind === "status" || (request.kind !== "mutate" && request.dataset === `records.${record.name}`));
            await act(async () => { answer.release(); });
            await reading.holding;
            await patchRecord(e3(), workspace(), record, next(await readDataset(e3(), workspace(), record)));
            await act(async () => { reading.release(); });
            await settle();
        },
        async late(record, save, next) {
            const answer = e3().holdAnswers((request) => request.kind === "mutate" && request.record === record.name);
            await act(async () => { save(); });
            await answer.holding;
            await patchRecord(e3(), workspace(), record, next(await readDataset(e3(), workspace(), record)));
            // What is mounted hears of the other session's write, and reads it, while the Save's answer is still out.
            await refreshMounted(workspace());
            await act(async () => { answer.release(); });
            await settle();
        },
        poll: () => refreshMounted(workspace()),
        async write(dataset, value) {
            await writeDataset(e3(), workspace(), dataset, value);
            await refreshMounted(workspace());
        },
        history: (record) => recordHistory(e3(), workspace(), record),
        async run() {
            await runDataflow(e3(), workspace());
            await refreshMounted(workspace());
        },
        requests: (kind, of) => workspaceRequests(e3(), workspace(), kind, of),
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
        <QueryPlanOptionsProvider pieceBytes={EXAMPLES_PIECE_MIN}>
            <E3Provider config={{ apiUrl: e3.apiUrl, fetch: e3.fetch, repo: e3.repo, workspace, token: null }}>
                <ReactiveDatasetProvider>
                    <PolledReads datasets={NO_READS} />
                    {children}
                </ReactiveDatasetProvider>
            </E3Provider>
        </QueryPlanOptionsProvider>
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

/** What builds each payload a test's own view draws again ({@link evaluateAgain}). */
const evaluations = new Set<() => void>();

/** What decodes each mounted builder's payload again ({@link evaluateAgain}). */
const redecodes = new Set<() => void>();

/** How many payloads {@link evaluateAgain} has handed a builder again, built or decoded anew. */
let handedAgain = 0;

/** What a tracker that reads nothing read. */
const NO_KEYS: ReadonlyMap<string, number> = new Map();

/**
 * The builders' extensions, by the names their components register under: the ones whose payload
 * {@link evaluateAgain} decodes again. A builder mounted under another name is handed nothing, and
 * {@link evaluateAgain} says so.
 */
const BUILDERS = ["Allocation", "Calendar", "Flowchart", "Plan", "Record", "Roster", "Schematic", "Sheet"] as const;

/** A builder's extension, as the dispatcher's registry holds it. */
type ExtensionEntry = NonNullable<ReturnType<typeof getExtensionEntry>>;

/** Whether the file's tests may evaluate what they mount again ({@link evaluatesAgain}). */
let handsAgain = false;

/**
 * Lets the file's tests evaluate what they mount again ({@link evaluateAgain}): called as the file is collected,
 * beside its harness. From then on each builder a test mounts through the harness is drawn through a renderer that
 * decodes its payload again when asked — and is handed what the dispatcher decoded, as it always is, until then.
 */
export function evaluatesAgain(): void {
    handsAgain = true;
}

/** The bytes each decoded payload arrived as. */
const arrivedAs = new WeakMap<object, Uint8Array>();

/** Each extension's decode that notes what a payload arrived as: put back where a test's own spy on it, restored, took it off. */
const noting = new WeakMap<ExtensionEntry, ExtensionEntry["decode"]>();

/** The extensions whose renderer decodes its payload again. */
const redecoding = new WeakSet<ExtensionEntry>();

/**
 * Has a builder's extension decode its payload again at each {@link evaluateAgain}: its decode notes the bytes each
 * payload arrived as, and its renderer is drawn through one that decodes those bytes again when asked. Until it is
 * asked, the renderer is handed what the dispatcher decoded, as it always is.
 *
 * @param kind - The extension's name
 */
function decodesAgain(kind: string): void {
    const entry = getExtensionEntry(kind);
    if (entry === undefined) return;
    if (noting.get(entry) !== entry.decode) {
        const decode = entry.decode;
        const noted: ExtensionEntry["decode"] = (bytes) => {
            const payload = decode(bytes);
            // A builder's payload is a struct.
            arrivedAs.set(payload as object, bytes);
            return payload;
        };
        entry.decode = noted;
        noting.set(entry, noted);
    }
    if (redecoding.has(entry)) return;
    redecoding.add(entry);
    const Renderer = entry.renderer;
    entry.renderer = function DecodedAgain({ value, storageKey }: { value: unknown; storageKey: string }) {
        const [asked, again] = useReducer((count: number) => count + 1, 0);
        useLayoutEffect(() => {
            redecodes.add(again);
            return () => { redecodes.delete(again); };
        }, [again]);
        const payload = useMemo(() => {
            const bytes = arrivedAs.get(value as object);
            if (asked === 0 || bytes === undefined) return value;
            handedAgain += 1;
            return entry.decode(bytes);
        }, [value, asked]);
        return <Renderer value={payload} storageKey={storageKey} />;
    };
}

/**
 * A payload a test's own view draws: built as its component mounts, and again at each {@link evaluateAgain} — as the
 * dispatcher's builders are handed theirs decoded again.
 *
 * @param build - What builds the payload; the same function from one render to the next
 * @returns The payload it built last
 */
export function useEvaluated<T>(build: () => T): T {
    const [asked, again] = useReducer((count: number) => count + 1, 0);
    useLayoutEffect(() => {
        evaluations.add(again);
        return () => { evaluations.delete(again); };
    }, [again]);
    return useMemo(() => {
        if (asked > 0) handedAgain += 1;
        return build();
    }, [build, asked]);
}

/**
 * Hands every builder mounted its payload again, made anew with nothing in it changed, and settles.
 *
 * A page's host evaluates its body again whenever something it reads moves — a State the app keeps, a dataset it
 * reads whole. A builder in it is drawn from its payload's bytes: while they are the same the dispatcher draws
 * nothing again, and once any value in them differs — a title, a count, a column's header — the whole payload is
 * decoded again, every function in it made anew over handles bound anew, whatever the value that moved. This is that,
 * with no value moved, so that nothing a builder draws may move:
 *
 * - each builder the dispatcher draws ({@link BUILDERS}) is handed its payload decoded again from the bytes it
 *   arrived as;
 * - each payload a test's own view draws is built again ({@link useEvaluated});
 * - and every tracked evaluation on the page runs again — each Reactive body, each builder's own tracked reads — as
 *   each does when a tracker registers, a provider mounting: with a tracker that reads nothing, registered and let
 *   go at once.
 *
 * @throws {Error} When the file has not said its tests evaluate again ({@link evaluatesAgain}), or no builder mounted
 *   was handed a payload again: the check it serves would hold nothing
 */
export async function evaluateAgain(): Promise<void> {
    if (!handsAgain) throw new Error("evaluateAgain: the file has not called evaluatesAgain(), beside its harness, so no builder it mounted decodes its payload again");
    const before = handedAgain;
    await act(async () => {
        for (const again of [...evaluations, ...redecodes]) again();
        registerReactiveTracker({ id: "evaluate-again", enableTracking() {}, disableTracking: () => NO_KEYS, getStore: () => null })();
    });
    await settle();
    if (handedAgain === before) {
        throw new Error("evaluateAgain handed no builder its payload again: mount the builder through the harness, and name its extension among BUILDERS");
    }
}

/** The example's program, compiled once its reads have loaded, rendered through the dispatcher. */
function Program({ example, program, storageKey }: { example: Example; program: UIProgram | undefined; storageKey: string }) {
    const value = useMemo(() => (program ?? programOf(example))(), [example, program]);
    return <EastChakraComponent value={value} storageKey={storageKey} />;
}

/** The timer real time passes on, as the page started with it: a test whose clock is fake (`vi.useFakeTimers`) settles on it too. */
const realSetTimeout = globalThis.setTimeout;

/** Lets real time pass for a few turns, React flushing between them. */
const turns = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => realSetTimeout(resolve, 0)); });

/**
 * Waits until React has flushed and no request to e3 is in flight — those a
 * hold parks aside — again until both hold at once with no request started
 * meanwhile. Outside a harness's file, it flushes React alone. It waits on
 * real time, so a test's fake clock stands still meanwhile: what the clock
 * starts, the test moves it on to.
 */
export async function settle(): Promise<void> {
    await settleE3(current?.e3, turns);
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
 * Lays every toolbar row out narrower than what it holds, as a phone's 294px frame lays its row out, tells the toolbars
 * as a resize does, and settles: each row 200px wide and each of its items 60px in whatever form it shows, so every step
 * of a row's ladder applies, the row is still too wide, and the rungs of its floor follow (east-ui-components'
 * `FLOOR_RANK`) — the rail's caret, then the Elara eye into its builder's View (ruled 27 Oct 2026, "Into the View
 * menu"). What else the harness measures it measures as before, and the layout goes with the test, as every measure does.
 *
 * @throws {Error} When the harness measures nothing (`measure: false`): this lays out over its measures
 */
export async function toolbarAtFloor(): Promise<void> {
    const rect = vi.mocked(Element.prototype.getBoundingClientRect);
    const measured = rect.getMockImplementation();
    if (measured === undefined) throw new Error("toolbarAtFloor lays a toolbar out over the harness's measures: the harness measures nothing");
    rect.mockImplementation(function (this: Element) {
        const px = this.hasAttribute("data-toolbar") ? 200 : this.hasAttribute("data-toolbar-item") ? 60 : undefined;
        return px === undefined ? measured.call(this) : { x: 0, y: 0, top: 0, left: 0, right: px, bottom: 28, width: px, height: 28, toJSON() {} };
    });
    await width(mainWidth);
}

/**
 * A builder frame's slot.
 *
 * @param container - What the example rendered into
 * @param name - The slot (`toolbar`, `main`, `start`, `end`, `footer`)
 * @returns The slot's element
 */
export const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`)!;

/**
 * A reload of the page, in the same tab: what it drew goes, with its UI store —
 * every editing session in it — and what it kept in memory; the tab's storage
 * stays, as a reload leaves it. Mount again after it, as the page loads again.
 */
export function reloadPage(): void {
    cleanup();
    StateRuntime.initializeStore(new UIStore());
    resetKept();
}

/** A card of the history bar's conflicts popover, as a person reads it: the item, each choice as it is read out, and the choices. */
export interface ConflictCard {
    /** The item, as the builder names it. */
    readonly item: string | null;
    /** The draft's choice, as it is read out — `Yours, 500`. */
    readonly yours: string | null;
    /** The newer value's, with where it came from and what both began from. */
    readonly theirs: string | null;
    /** A choice's radio. */
    readonly radio: (choice: "draft" | "source") => HTMLInputElement;
    /** Its Go to. */
    readonly goTo: () => HTMLButtonElement;
}

/**
 * The cards of the history bar's conflicts popover — opened from its button
 * first, unless it is open already (a banner's Choose opens it).
 *
 * @param container - The builder's container, whose toolbar holds the button
 * @returns Each card, in the popover's order
 */
export async function conflictCards(container: HTMLElement): Promise<ConflictCard[]> {
    if (document.querySelector("[data-conflict-card]") === null) {
        await act(async () => { container.querySelector<HTMLElement>("[data-conflicts]")!.click(); });
    }
    await waitFor(() => { if (document.querySelector("[data-conflict-card]") === null) throw new Error("the conflicts popover shows no card"); });
    return [...document.querySelectorAll<HTMLElement>("[data-conflict-card]")].map((card) => ({
        item: card.querySelector("[data-conflict-item]")?.textContent ?? null,
        yours: card.querySelector("[data-choice=draft] input")?.getAttribute("aria-label") ?? null,
        theirs: card.querySelector("[data-choice=source] input")?.getAttribute("aria-label") ?? null,
        radio: (choice) => card.querySelector<HTMLInputElement>(`[data-choice=${choice}] input`)!,
        goTo: () => card.querySelector<HTMLButtonElement>("[data-conflict-go]")!,
    }));
}
