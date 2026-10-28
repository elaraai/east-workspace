/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The e3 the showcase runs in its page (#849): every e3 example reads,
 * writes, pages and calls through it.
 *
 * It starts the first time an e3 example renders ({@link startShowcaseE3}),
 * so a page with none starts no worker and fetches nothing: the e3 worker
 * starts (`e3.worker.ts`: e3-web, its repositories in memory) and its
 * repository is created. Each area — the e3 examples of one category, one
 * directory of e3-ui's `test/` ({@link e3AreaOf}) — has a workspace of its own
 * (#1397), which starts the first time one of the area's examples shows:
 * - its package is fetched, the zip served beside the page at the URL the
 *   bundle carries for the area (`virtual:e3-showcase-packages`) — the build
 *   names it by its content, so a page never imports a package another build
 *   made — holding what the area's examples read and no other area's work
 *   (e3-ui's examples' package step);
 * - through e3's client, over the worker's `fetch`, the package is imported,
 *   the area's workspace created and the package deployed to it, and its
 *   dataflow run once, so every task's output exists before an example reads
 *   it.
 * Areas start one at a time, in the order their examples showed.
 *
 * The runtimes `Data.bind`, `Data.bindPaged`, `Func.bind` and `Record.bind`
 * resolve through are process-global, so they serve one workspace: the area
 * whose example showed last ({@link shownShowcaseE3}), once it has started.
 * `ShowcaseE3Runtime` mounts e3-ui-components' providers over it, which install
 * them, and hands their dataset cache here ({@link setShowcaseE3Cache}): each of
 * the area's examples loads what it reads through it, and renders then. A page
 * shows one area. An area left keeps its workspace, and what its examples read
 * loads again when the page shows it again. A start that fails says which step
 * failed and why, and only the area's examples show it, each with a Retry
 * ({@link retryShowcaseE3}), which goes on from the step that failed.
 *
 * The e3 lives as long as the page, and so do the areas' workspaces and the
 * edits staged against them.
 *
 * A responsive spec that asks for it before the page loads gets a fault hook
 * over the e3's `fetch` (`showcase-e3-faults.ts`, #1398), which holds, fails
 * and releases the page's requests by what they ask and the dataset they
 * name, and applies a record's mutation of the spec's own, as another session
 * would; no page a person opens has it.
 *
 * @packageDocumentation
 */

import { IntegerType, printFor } from "@elaraai/east";
import { createWebE3, type WebE3 } from "@elaraai/e3-web";
import {
    dataflowExecute, packageImport, repoCreate, taskLogs, workspaceCreate, workspaceDeploy,
    type DataflowResult, type RequestOptions,
} from "@elaraai/e3-api-client";
import { pathToString, type TreePath } from "@elaraai/e3-types";
import {
    MemoryStagedAdapter, StagedStore, formatApiError, initializeStagedStore, type ReactiveDatasetCacheInterface,
} from "@elaraai/e3-ui-components";
import packageUrl from "virtual:e3-showcase-packages";
import { withFaults } from "./showcase-e3-faults";

// The e3 keeps its repositories in memory, so the edits staged against it are
// kept there too. Kept in IndexedDB, as they are by default, they would
// outlive a reload, which starts e3 afresh from its packages, and stand over
// values the new e3 never held.
initializeStagedStore(new StagedStore(new MemoryStagedAdapter()));

/** The repository every area's package is imported into. */
export const SHOWCASE_REPO = "default";

/** How often what an e3 example reads is polled while it shows, so a write,
 *  a mutation or a dataflow run reaches it: as often as a UI task's preview
 *  polls its reads (`UITaskPreview`'s default). */
export const SHOWCASE_POLL_MS = 1000;

/**
 * The area of an e3 example: the directory of e3-ui's `test/` its module is
 * in, as e3-ui's examples' package step names it (`exampleArea`) — the
 * category the showcase shows it under.
 *
 * @param pathKey - The example module's catalog key, `e3/<area>/…` (`catalog.ts`)
 * @returns Its area, e.g. `schematic`
 */
export function e3AreaOf(pathKey: string): string {
    return pathKey.split("/", 2)[1] ?? pathKey;
}

/**
 * The workspace an area's package is deployed to, which its examples bind.
 *
 * @param area - The area
 * @returns The area's own name
 */
export function showcaseE3Workspace(area: string): string {
    return area;
}

/** Where an area's workspace is. */
export type ShowcaseE3Status =
    /** Not started: none of the area's examples has rendered yet. */
    | { readonly state: "idle" }
    /** Starting: the page's e3, or the area's package, its deploy or its
     *  first run. */
    | { readonly state: "starting" }
    /** Deployed, its dataflow run once; `cache` is the dataset cache of
     *  e3-ui-components' runtimes while they serve the area. */
    | { readonly state: "ready"; readonly e3: WebE3; readonly cache: ReactiveDatasetCacheInterface | null }
    /** It did not start: the error names the step and the cause. */
    | { readonly state: "failed"; readonly error: Error };

const IDLE: ShowcaseE3Status = { state: "idle" };
const STARTING: ShowcaseE3Status = { state: "starting" };

/** Each area's status, once it has left idle. */
const statuses = new Map<string, ShowcaseE3Status>();
/** The area whose example showed last: the one the runtimes serve. */
let shown: string | undefined;
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of listeners) listener();
}

function publish(area: string, next: ShowcaseE3Status): void {
    statuses.set(area, next);
    notify();
}

/**
 * Where an area's workspace is now: the same object until it moves, as
 * `useSyncExternalStore` reads it.
 *
 * @param area - The area
 * @returns Its status
 */
export function showcaseE3Status(area: string): ShowcaseE3Status {
    return statuses.get(area) ?? IDLE;
}

/**
 * The area whose example showed last, which the runtimes serve once it has
 * started: none until an e3 example has rendered.
 *
 * @returns The area, or `undefined`
 */
export function shownShowcaseE3(): string | undefined {
    return shown;
}

/**
 * Listens for an area's workspace to move, or another area's example to show.
 *
 * @param listener - Called after each move
 * @returns What stops listening
 */
export function subscribeShowcaseE3(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Says an area's example shows: what an e3 example calls as it mounts. The
 * area becomes the one the runtimes serve, and its workspace starts the
 * first time; every later call for it starts nothing.
 *
 * @param area - The example's area ({@link e3AreaOf})
 */
export function startShowcaseE3(area: string): void {
    if (shown !== area) {
        shown = area;
        notify();
    }
    if (showcaseE3Status(area).state === "idle") boot(area);
}

/**
 * Starts an area's workspace again after a start that failed, from the step
 * that failed: what its examples' Retry calls. It does nothing while the area
 * is starting or ready.
 *
 * @param area - The area
 */
export function retryShowcaseE3(area: string): void {
    if (showcaseE3Status(area).state === "failed") boot(area);
}

/** The areas' starts, one after another. */
let starts: Promise<void> = Promise.resolve();

function boot(area: string): void {
    publish(area, STARTING);
    starts = starts.then(() => startArea(area).then(
        (e3) => publish(area, { state: "ready", e3, cache: null }),
        (err: unknown) => publish(area, { state: "failed", error: err instanceof Error ? err : new Error(String(err)) }),
    ));
}

/**
 * Hands over the dataset cache of e3-ui-components' runtimes, installed over
 * an area's workspace — or `null` once they are torn down: `ShowcaseE3Runtime`'s
 * providers hand it over as they install them, and take it back as they go.
 *
 * @param area - The area the runtimes serve
 * @param cache - The installed runtimes' dataset cache, or `null`
 */
export function setShowcaseE3Cache(area: string, cache: ReactiveDatasetCacheInterface | null): void {
    const status = showcaseE3Status(area);
    if (status.state === "ready" && !Object.is(status.cache, cache)) publish(area, { ...status, cache });
}

/** What an error says: an API error's code and details, any other's message. */
function causeOf(err: unknown): string {
    const { message, details } = formatApiError(err);
    return details === undefined ? message : `${message}: ${details}`;
}

/** Runs one step of a start, naming it if it fails. */
async function step<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (err) {
        throw new Error(`could not ${what}: ${causeOf(err)}`, { cause: err });
    }
}

/** What has loaded into each installed cache, each path as e3 prints it: the
 *  cache keeps what it loaded for as long as it lives. */
const loadedInto = new WeakMap<ReactiveDatasetCacheInterface, Set<string>>();

/**
 * Whether everything an e3 example reads has loaded into the runtimes'
 * dataset cache — by this example, or by another reading the same.
 *
 * @param cache - The installed runtimes' dataset cache
 * @param paths - What the example reads
 * @returns Whether every path has loaded
 */
export function exampleReadsLoaded(cache: ReactiveDatasetCacheInterface, paths: readonly TreePath[]): boolean {
    const loaded = loadedInto.get(cache);
    return paths.every((path) => loaded?.has(pathToString(path)) ?? false);
}

/**
 * Loads what an e3 example reads into the runtimes' dataset cache — every
 * dataset and record its bindings read whole (its manifest's `paths`), as a UI
 * task's preview loads its manifest's before it renders. A dataset with no
 * value yet loads as unset, which the example's own bindings show.
 *
 * @param cache - The installed runtimes' dataset cache
 * @param workspace - The workspace of the example's area
 * @param paths - What the example reads
 * @throws {Error} Naming the first read that failed and its cause
 */
export async function loadExampleReads(cache: ReactiveDatasetCacheInterface, workspace: string, paths: readonly TreePath[]): Promise<void> {
    await Promise.all(paths.map((path) => step(`read ${pathToString(path)}`, () => cache.preload(workspace, path))));
    let loaded = loadedInto.get(cache);
    if (loaded === undefined) {
        loaded = new Set();
        loadedInto.set(cache, loaded);
    }
    for (const path of paths) loaded.add(pathToString(path));
}

/** An area's package: the zip served beside the page, at the URL the bundle
 *  carries for the area. */
async function fetchPackage(area: string): Promise<Uint8Array> {
    const url = packageUrl(area);
    if (url === undefined) throw new Error(`the showcase was built with no package for the area '${area}'`);
    const response = await fetch(url);
    if (!response.ok) {
        // The dev server answers a failed package step with what it said.
        const said = (await response.text()).trim();
        throw new Error(`${url} answered ${response.status} ${response.statusText}${said === "" ? "" : `: ${said}`}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

const printInteger = printFor(IntegerType);

/** What a dataflow run that did not succeed says of each task that failed —
 *  its error, or how it exited and its stderr's lines but the stack — or
 *  nothing, when none did. */
async function runFailures(e3: WebE3, workspace: string, options: RequestOptions, run: DataflowResult): Promise<string> {
    const said = await Promise.all(run.tasks.map(async (task): Promise<string[]> => {
        switch (task.state.type) {
            case "error":
                return [`task '${task.name}': ${task.state.value.message}`];
            case "failed": {
                const exited = `task '${task.name}' exited ${printInteger(task.state.value.exitCode)}`;
                const stderr = await taskLogs(e3.apiUrl, SHOWCASE_REPO, workspace, task.name, { stream: "stderr" }, options)
                    .then((chunk) => chunk.data.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("  at ")).join(" "))
                    .catch(() => "");
                return [stderr === "" ? exited : `${exited}: ${stderr}`];
            }
            case "success":
            case "skipped":
                return [];
        }
    }));
    return said.flat().join("; ");
}

/** The page's e3, started as the first area starts — and again after a start
 *  of it that failed. */
let page: Promise<WebE3> | undefined;

function pageE3(): Promise<WebE3> {
    page ??= startPage().catch((err: unknown) => {
        page = undefined;
        throw err;
    });
    return page;
}

/**
 * Starts the e3 worker and creates its repository.
 *
 * @returns The e3
 * @throws {Error} Naming the step that failed and its cause; the worker is
 *   closed
 */
async function startPage(): Promise<WebE3> {
    // Its fetch goes through the responsive suite's fault hook when a spec asked for it before the page loaded
    // (`showcase-e3-faults.ts`); a page a person opens has none.
    const e3 = withFaults(await step("start its e3 worker", () =>
        createWebE3(new Worker(new URL("./e3.worker.ts", import.meta.url), { type: "module" }))), SHOWCASE_REPO);
    try {
        await step("create its repository", () => repoCreate(e3.apiUrl, SHOWCASE_REPO, { token: null, fetch: e3.fetch }));
        return e3;
    } catch (err) {
        e3.close();
        throw err;
    }
}

/** What an area's start has done in an e3, kept across a start that failed so
 *  its Retry goes on from the step that failed. */
interface Progress {
    readonly e3: WebE3;
    /** The package it imported, `name@version`. */
    imported?: string;
    /** Whether it has made the area's workspace. */
    created?: boolean;
}

const progress = new Map<string, Progress>();

/**
 * Starts an area's workspace: the page's e3 first, then the area's package
 * imported, its workspace made, the package deployed to it and its dataflow
 * run.
 *
 * @param area - The area
 * @returns The e3, the area's workspace deployed and run once
 * @throws {Error} Naming the step that failed and its cause
 */
async function startArea(area: string): Promise<WebE3> {
    const e3 = await pageE3();
    const options: RequestOptions = { token: null, fetch: e3.fetch };
    const workspace = showcaseE3Workspace(area);
    let done = progress.get(area);
    if (done === undefined || !Object.is(done.e3, e3)) {
        done = { e3 };
        progress.set(area, done);
    }
    if (done.imported === undefined) {
        const zip = await step("fetch its package", () => fetchPackage(area));
        const { name, version } = await step("import its package", () => packageImport(e3.apiUrl, SHOWCASE_REPO, zip, options));
        done.imported = `${name}@${version}`;
    }
    if (done.created !== true) {
        await step("create its workspace", () => workspaceCreate(e3.apiUrl, SHOWCASE_REPO, workspace, options));
        done.created = true;
    }
    const imported = done.imported;
    await step("deploy its package", () => workspaceDeploy(e3.apiUrl, SHOWCASE_REPO, workspace, imported, options));
    // A run in the page answers its polls at once, so they come often.
    const run = await step("run its dataflow", () =>
        dataflowExecute(e3.apiUrl, SHOWCASE_REPO, workspace, {}, options, { pollInterval: 100 }));
    if (!run.success) {
        const failures = await runFailures(e3, workspace, options, run);
        throw new Error(`its dataflow did not succeed${failures === "" ? "" : `: ${failures}`}`);
    }
    return e3;
}
