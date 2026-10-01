/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The e3 the showcase runs in its page (#849): every e3 example reads,
 * writes, pages and calls through it.
 *
 * It starts the first time an e3 example renders ({@link startShowcaseE3}),
 * so a page with none starts no worker and fetches nothing. Starting it:
 * - starts the e3 worker (`e3.worker.ts`: e3-web, its repositories in memory);
 * - fetches the showcase's package, the zip served beside the page — at the
 *   URL the bundle carries (`virtual:e3-showcase-package`): the build names
 *   it by its content, so a page never imports a package another build made;
 * - through e3's client, over the worker's `fetch`: creates the repository,
 *   imports the package, creates the workspace, deploys the package to it,
 *   and runs its dataflow once, so every task's output exists before an
 *   example reads it.
 *
 * Once it is ready, `ShowcaseE3Runtime` mounts e3-ui-components' providers
 * over it, which install the runtimes `Data.bind`, `Data.bindPaged`,
 * `Func.bind` and `Record.bind` resolve through, and hands their dataset
 * cache here ({@link setShowcaseE3Cache}): each e3 example loads what it
 * reads through it, and renders then. A start that fails says which step
 * failed and why, and only the e3 examples show it, each with a Retry
 * ({@link retryShowcaseE3}).
 *
 * The e3 lives as long as the page, and so do the edits staged against it.
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
import packageUrl from "virtual:e3-showcase-package";

// The e3 keeps its repositories in memory, so the edits staged against it are
// kept there too. Kept in IndexedDB, as they are by default, they would
// outlive a reload, which starts e3 afresh from its package, and stand over
// values the new e3 never held.
initializeStagedStore(new StagedStore(new MemoryStagedAdapter()));

/** The repository the showcase's package is imported into. */
export const SHOWCASE_REPO = "default";

/** The workspace the showcase's package is deployed to, which every e3
 *  example binds. */
export const SHOWCASE_WORKSPACE = "showcase";

/** How often what an e3 example reads is polled while it shows, so a write,
 *  a mutation or a dataflow run reaches it: as often as a UI task's preview
 *  polls its reads (`UITaskPreview`'s default). */
export const SHOWCASE_POLL_MS = 1000;

/** Where the showcase's e3 is. */
export type ShowcaseE3Status =
    /** Not started: no e3 example has rendered yet. */
    | { readonly state: "idle" }
    /** Starting: its worker, its package, its deploy or its first run. */
    | { readonly state: "starting" }
    /** Deployed, its dataflow run once; `cache` is the dataset cache of
     *  e3-ui-components' runtimes once they are installed over it. */
    | { readonly state: "ready"; readonly e3: WebE3; readonly cache: ReactiveDatasetCacheInterface | null }
    /** It did not start: the error names the step and the cause. */
    | { readonly state: "failed"; readonly error: Error };

let status: ShowcaseE3Status = { state: "idle" };
const listeners = new Set<() => void>();

function publish(next: ShowcaseE3Status): void {
    status = next;
    for (const listener of listeners) listener();
}

/**
 * Where the showcase's e3 is now: the same object until it moves, as
 * `useSyncExternalStore` reads it.
 *
 * @returns The status
 */
export function showcaseE3Status(): ShowcaseE3Status {
    return status;
}

/**
 * Listens for the showcase's e3 to move.
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
 * Starts the showcase's e3, the first time it is called: what an e3 example
 * calls as it mounts. Every later call does nothing.
 */
export function startShowcaseE3(): void {
    if (status.state === "idle") boot();
}

/**
 * Starts the showcase's e3 again after a start that failed: what an e3
 * example's Retry calls. It does nothing while e3 is starting or ready.
 */
export function retryShowcaseE3(): void {
    if (status.state === "failed") boot();
}

function boot(): void {
    publish({ state: "starting" });
    start().then(
        (e3) => publish({ state: "ready", e3, cache: null }),
        (err: unknown) => publish({ state: "failed", error: err instanceof Error ? err : new Error(String(err)) }),
    );
}

/**
 * Hands over the dataset cache of e3-ui-components' runtimes, installed over
 * the showcase's e3 — or `null` once they are torn down: `ShowcaseE3Runtime`'s
 * providers hand it over as they install them, and take it back as they go.
 *
 * @param cache - The installed runtimes' dataset cache, or `null`
 */
export function setShowcaseE3Cache(cache: ReactiveDatasetCacheInterface | null): void {
    if (status.state === "ready" && !Object.is(status.cache, cache)) publish({ ...status, cache });
}

/** What an error says: an API error's code and details, any other's message. */
function causeOf(err: unknown): string {
    const { message, details } = formatApiError(err);
    return details === undefined ? message : `${message}: ${details}`;
}

/** Runs one step of the start, naming it if it fails. */
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
 * @param paths - What the example reads
 * @throws {Error} Naming the first read that failed and its cause
 */
export async function loadExampleReads(cache: ReactiveDatasetCacheInterface, paths: readonly TreePath[]): Promise<void> {
    await Promise.all(paths.map((path) => step(`read ${pathToString(path)}`, () => cache.preload(SHOWCASE_WORKSPACE, path))));
    let loaded = loadedInto.get(cache);
    if (loaded === undefined) {
        loaded = new Set();
        loadedInto.set(cache, loaded);
    }
    for (const path of paths) loaded.add(pathToString(path));
}

/** The showcase's package: the zip served beside the page, at the URL the
 *  bundle carries. */
async function fetchPackage(): Promise<Uint8Array> {
    const response = await fetch(packageUrl);
    if (!response.ok) {
        // The dev server answers a failed package step with what it said.
        const said = (await response.text()).trim();
        throw new Error(`${packageUrl} answered ${response.status} ${response.statusText}${said === "" ? "" : `: ${said}`}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

const printInteger = printFor(IntegerType);

/** What a dataflow run that did not succeed says of each task that failed —
 *  its error, or how it exited and its stderr's lines but the stack — or
 *  nothing, when none did. */
async function runFailures(e3: WebE3, options: RequestOptions, run: DataflowResult): Promise<string> {
    const said = await Promise.all(run.tasks.map(async (task): Promise<string[]> => {
        switch (task.state.type) {
            case "error":
                return [`task '${task.name}': ${task.state.value.message}`];
            case "failed": {
                const exited = `task '${task.name}' exited ${printInteger(task.state.value.exitCode)}`;
                const stderr = await taskLogs(e3.apiUrl, SHOWCASE_REPO, SHOWCASE_WORKSPACE, task.name, { stream: "stderr" }, options)
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

/**
 * Starts the e3 worker, then imports, deploys and runs the showcase's package
 * in it.
 *
 * @returns The e3, deployed and run once
 * @throws {Error} Naming the step that failed and its cause; the worker is
 *   closed
 */
async function start(): Promise<WebE3> {
    const e3 = await step("start its e3 worker", () =>
        createWebE3(new Worker(new URL("./e3.worker.ts", import.meta.url), { type: "module" })));
    try {
        const options: RequestOptions = { token: null, fetch: e3.fetch };
        const zip = await step("fetch its package", fetchPackage);
        await step("create its repository", () => repoCreate(e3.apiUrl, SHOWCASE_REPO, options));
        const { name, version } = await step("import its package", () => packageImport(e3.apiUrl, SHOWCASE_REPO, zip, options));
        await step("create its workspace", () => workspaceCreate(e3.apiUrl, SHOWCASE_REPO, SHOWCASE_WORKSPACE, options));
        await step("deploy its package", () =>
            workspaceDeploy(e3.apiUrl, SHOWCASE_REPO, SHOWCASE_WORKSPACE, `${name}@${version}`, options));
        // A run in the page answers its polls at once, so they come often.
        const run = await step("run its dataflow", () =>
            dataflowExecute(e3.apiUrl, SHOWCASE_REPO, SHOWCASE_WORKSPACE, {}, options, { pollInterval: 100 }));
        if (!run.success) {
            const failures = await runFailures(e3, options, run);
            throw new Error(`its dataflow did not succeed${failures === "" ? "" : `: ${failures}`}`);
        }
        return e3;
    } catch (err) {
        e3.close();
        throw err;
    }
}
