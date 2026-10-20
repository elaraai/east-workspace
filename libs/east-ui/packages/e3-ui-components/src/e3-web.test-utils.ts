/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 itself under test (#1375): e3-web in this process, with the e3-ui
 * example modules a test file names deployed to it, as the showcase runs its
 * examples. A test reads, pages, saves and calls through e3, never a stand-in
 * that answers at once and says what the test wrote.
 *
 * - **Per file**, {@link startTestE3} starts e3-web as e3's own compliance
 *   specs do — its worker's side (`serveE3`) at one end of a `MessageChannel`,
 *   the page's (`createWebE3`) at the other, its repositories in memory and
 *   its units in this thread — imports the package of the modules
 *   (`@elaraai/e3-ui/examples-package`, the step the showcase's package is
 *   made by), deploys it to a workspace and runs its dataflow once. That
 *   first deploy pays for the records' initial values and their indexes.
 * - **Per test**, {@link TestE3.workspace} copies that workspace, its records,
 *   indexes and task outputs with it, so nothing runs again and no test sees
 *   another's writes.
 * - **Every request** goes through {@link TestE3.fetch}: it is logged
 *   ({@link E3Request}: what it asks, of which dataset or record, and what it
 *   sent), counted in flight, and held or failed where the test says
 *   ({@link TestE3.hold}, {@link TestE3.fail}) — a fault at the network's
 *   boundary, over e3's real answer to everything else — and its answer kept
 *   where the test asks ({@link TestE3.answers}).
 * - **Every unit** e3 runs — a task, a piece of a split call, a one-shot — runs
 *   in this thread (`inProcessUnits`), and may be held before it starts
 *   ({@link TestE3.holdUnits}): a split call caught with some of its pieces
 *   run. e3 cuts a split task's pieces as the showcase's does
 *   ({@link EXAMPLES_PIECE_BYTES}).
 * - **Another session's changes** go in through e3's API:
 *   {@link patchRecord}, {@link writeDataset}; what e3 holds is read back
 *   through it ({@link readDataset}). These are the test's own requests
 *   ({@link TestE3.direct}): never logged, held or failed.
 *
 * It reaches nothing of the DOM, so a spec under `node --test` uses it as a
 * DOM test does; `e3-web-mount.test-utils.tsx` mounts an example over it.
 *
 * @packageDocumentation
 */

import { decodeBeast2For, diffFor, encodeBeast2For, none, PatchType, some, type EastType, type ValueTypeOf } from "@elaraai/east";
import {
    dataflowExecute, datasetGet, datasetSet, packageImport, repoCreate, workspaceCopy, workspaceCreate, workspaceDeploy,
    workspaceRecordHistory, workspaceRecordMutate, type MutationResult, type RecordHistoryResult, type RequestOptions,
} from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import { exampleModule, examplesPackageZip } from "@elaraai/e3-ui/examples-package";
import { createWebE3, inProcessUnits, type HostMessage, type UnitWorker, type WebE3, type WorkerMessage } from "@elaraai/e3-web";
import { serveE3 } from "@elaraai/e3-web/worker";

/** The repository the package is imported into. */
export const TEST_REPO = "default";

/** The workspace the package is deployed to, which each test's workspace copies. */
const DEPLOYED = "deployed";

/**
 * The size e3 cuts a split task's pieces at here, in stored bytes: the
 * showcase's (`east-ui-showcase/showcase-pieces.ts`, its e3 worker's
 * `pieceBytes`), so a query over the examples' generated order history —
 * megabytes — runs as a split call over its pieces here as there.
 */
export const EXAMPLES_PIECE_BYTES = 64 * 1024;

/**
 * The smallest piece e3 cuts here: a quarter of {@link EXAMPLES_PIECE_BYTES}.
 * The query builder plans a run over a dataset that weighs more as a split
 * call, as the showcase's `QueryPlanOptionsProvider` tells it.
 */
export const EXAMPLES_PIECE_MIN = EXAMPLES_PIECE_BYTES / 4;

/** What a request asks e3. */
export type E3RequestKind =
    /** A dataset or record read whole. */
    | "read"
    /** A key search of a dataset, or of a record through one of its indexes. */
    | "find"
    /** A page of a dataset, or of a record through one of its indexes. */
    | "page"
    /** A dataset written. */
    | "write"
    /** A dataset's status, or a listing of datasets. */
    | "dataset-status"
    /** A record's mutations described. */
    | "describe"
    /** A record's commits. */
    | "history"
    /** A record's mutation: a patch, a reduce, an edit. */
    | "mutate"
    /** A record's history compacted. */
    | "compact"
    /** A named function called, or described. */
    | "call"
    /** A one-shot call. */
    | "one-shot"
    /** A split call launched, or explained (`explain=1`); or its job polled, the job's id its `name`. */
    | "split"
    /** A workspace's status. */
    | "status"
    /** A dataflow run started, polled or cancelled. */
    | "dataflow"
    /** A task's details, executions or logs. */
    | "task"
    /** Anything else: a repository's, a package's, a workspace's own routes. */
    | "other";

/** One request a test's code made of e3. */
export interface E3Request {
    /** Its method. */
    readonly method: string;
    /** What it asks. */
    readonly kind: E3RequestKind;
    /** The workspace it names, when it names one. */
    readonly workspace: string | undefined;
    /** The dataset it names, its path's fields joined by dots (`records.jobs`), for a dataset's route. */
    readonly dataset: string | undefined;
    /** The record it names (`jobs`), for a record's route; a record's dataset route names it as `dataset`. */
    readonly record: string | undefined;
    /** The mutation or function it names, for a mutation's or a call's route; the job's id, for a split call's poll. */
    readonly name: string | undefined;
    /** Its query. */
    readonly query: URLSearchParams;
    /** Its path after `/api`, decoded. */
    readonly path: string;
    /** The key a retry repeats so it cannot apply twice (`Idempotency-Key`), when it sends one. */
    readonly idempotencyKey: string | undefined;
    /** The credentials it carries (`Authorization`), when it carries any. */
    readonly authorization: string | undefined;
    /** What it sent, when it sent its body whole — every body e3's client sends; a request's body is decoded by its route's type. */
    readonly body: Uint8Array | undefined;
    /** Its signal: aborted once its caller gave it up. */
    readonly signal: AbortSignal;
}

/** e3's answer to a request, as {@link TestE3.answers} keeps it. */
export interface E3Answer {
    /** The request it answers. */
    readonly request: E3Request;
    /** Its HTTP status. */
    readonly status: number;
    /** Its body: beast2 of the route's response type, or the JSON of a failure. */
    readonly body: Uint8Array;
}

/** Which requests a hold or a fault takes. */
export type E3Match = (request: E3Request) => boolean;

/** Requests held in flight until the test lets them go. */
export interface E3Hold {
    /** How many requests it holds now. */
    readonly held: number;
    /** Settles once it holds a request. */
    readonly holding: Promise<void>;
    /** Lets the request it has held longest go on to e3; it holds the others, and those still to come. */
    releaseOne(): void;
    /** Lets the request it has held the shortest go on to e3, as a slow answer's overtaker; it holds the others, and those still to come. */
    releaseLast(): void;
    /** Lets every request it holds go on to e3, and holds no more. */
    release(): void;
}

/** Units e3 runs, held before they start until the test lets them go. */
export interface E3UnitHold {
    /** How many units it holds now. */
    readonly held: number;
    /** Settles once it holds a unit. */
    readonly holding: Promise<void>;
    /**
     * Lets the unit it has held longest start — once it holds one — and
     * settles once that unit has run; it holds the others, and those still to
     * come.
     */
    releaseOne(): Promise<void>;
    /** Lets every unit it holds start, and holds no more. */
    release(): void;
}

/**
 * How a fault answers:
 * - as e3 answers a failure: its HTTP status, its error's type and message;
 * - `network`: the request never reaches e3, and the fetch fails as a network does;
 * - `lost`: e3 answers the request — a mutation commits — but its answer never arrives, and the fetch fails as a network does.
 */
export type E3Failure = { readonly status?: number; readonly type?: string; readonly message?: string } | "network" | "lost";

/** e3 under test: see the module's documentation. */
export interface TestE3 {
    /** Where e3's client sends its requests: e3-web's own URL. */
    readonly apiUrl: string;
    /** The repository the package is in. */
    readonly repo: string;
    /** The fetch every request to e3 goes through: logged, counted, and held or failed as the test says. */
    readonly fetch: typeof globalThis.fetch;
    /** e3's client's options over {@link fetch}. */
    readonly options: RequestOptions;
    /** e3's client's options for the test's own requests, as another session's: never logged, held or failed. */
    readonly direct: RequestOptions;
    /** Each request made through {@link fetch}, in order. A test may empty it. */
    readonly requests: E3Request[];
    /** A fresh workspace: a copy of the one the package is deployed to, its dataflow run. */
    workspace(): Promise<string>;
    /** How many requests are in flight now, those a hold parks among them. */
    inFlight(): number;
    /** How many requests have been made through {@link fetch}. */
    started(): number;
    /** Settles once no request is in flight but those a hold parks. */
    idle(): Promise<void>;
    /** Holds each request it matches in flight, from now until released. */
    hold(match: E3Match): E3Hold;
    /** Answers each request it matches as e3 answers a failure, from now until the returned function stops it. */
    fail(match: E3Match, failure?: E3Failure): () => void;
    /**
     * Keeps the answer to each request it matches, from now until the test
     * ends: e3's, or the failure a fault answered with. A request that never
     * had one — lost, given up, failed as a network fails — has none.
     *
     * @param match - The requests whose answers it keeps
     * @returns Their answers, in the order they came, as they come
     */
    answers(match: E3Match): readonly E3Answer[];
    /** Holds each unit e3 starts from now — a task, a piece, a one-shot — before it runs, until released. */
    holdUnits(): E3UnitHold;
    /**
     * Counts the test's own work as a request in flight until it settles, so
     * {@link idle} waits for it: another session's write that a held request
     * waits on, say.
     *
     * @param work - The work
     * @returns The same work
     */
    background<T>(work: Promise<T>): Promise<T>;
    /** Lets every hold go — its units' too — stops every fault and keeps no more answers, as a test ends. */
    reset(): void;
    /** Stops e3-web. */
    close(): void;
}

/** A dataset or a record e3 holds: its path and its type, as an e3 definition gives them. */
export interface E3Dataset<T extends EastType = EastType> {
    /** Where e3 keeps it. */
    readonly path: TreePath;
    /** Its type. */
    readonly type: T;
}

/** A record e3 holds: its name, where e3 keeps it and its type, as `e3.record` gives them. */
export interface E3Record<T extends EastType = EastType> extends E3Dataset<T> {
    /** Its name. */
    readonly name: string;
}

/** A route's path after `/api`, split into its decoded segments. */
function segmentsOf(url: URL): string[] {
    const after = url.pathname.replace(/^\/api\/?/, "");
    return after === "" ? [] : after.split("/").map((segment) => decodeURIComponent(segment));
}

/**
 * What a request asks e3, read from its route as e3's API server routes it.
 *
 * @param method - The request's method
 * @param url - The request's URL
 * @param headers - The request's headers
 * @returns The request, as the log keeps it
 */
export function e3RequestOf(
    method: string, url: URL, headers: Headers = new Headers(), body?: Uint8Array, signal: AbortSignal = new AbortController().signal,
): E3Request {
    const path = segmentsOf(url);
    const query = url.searchParams;
    const base = {
        method, query, path: `/${path.join("/")}`, idempotencyKey: headers.get("Idempotency-Key") ?? undefined,
        authorization: headers.get("Authorization") ?? undefined, body, signal,
    };
    // repos/<repo>/workspaces/<ws>/<area>/…
    if (path[0] !== "repos" || path[2] !== "workspaces" || path[3] === undefined) {
        return { ...base, kind: "other", workspace: undefined, dataset: undefined, record: undefined, name: undefined };
    }
    const workspace = path[3];
    const area = path[4];
    const rest = path.slice(5);
    const unnamed = { workspace, dataset: undefined, record: undefined, name: undefined };
    switch (area) {
        case "datasets": {
            const dataset = rest.length === 0 ? undefined : rest.join(".");
            const named = { ...unnamed, dataset, record: undefined };
            if (method !== "GET") return { ...base, ...named, kind: "write" };
            if (query.get("find") === "true") return { ...base, ...named, kind: "find" };
            if (query.get("page") === "true") return { ...base, ...named, kind: "page" };
            if (query.get("status") === "true" || query.get("list") === "true" || dataset === undefined) {
                return { ...base, ...named, kind: "dataset-status" };
            }
            return { ...base, ...named, kind: "read" };
        }
        case "records": {
            const record = rest[0];
            if (rest[1] === "mutations") return { ...base, ...unnamed, record, name: rest[2], kind: "mutate" };
            if (rest[1] === "history") return { ...base, ...unnamed, record, kind: "history" };
            if (rest[1] === "compact") return { ...base, ...unnamed, record, kind: "compact" };
            return { ...base, ...unnamed, record, kind: "describe" };
        }
        case "functions":
            return { ...base, ...unnamed, name: rest[0], kind: "call" };
        case "one-shot":
            return rest[0] === "split" ? { ...base, ...unnamed, name: rest[1], kind: "split" } : { ...base, ...unnamed, kind: "one-shot" };
        case "status":
            return { ...base, ...unnamed, kind: "status" };
        case "dataflow":
            return { ...base, ...unnamed, kind: "dataflow" };
        case "tasks":
            return { ...base, ...unnamed, name: rest[0], kind: "task" };
        default:
            return { ...base, ...unnamed, kind: "other" };
    }
}

/** What a request's signal aborting rejects with, as `fetch` rejects. */
function aborted(signal: AbortSignal): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

/**
 * A body e3's client sent whole, as bytes — a copy, so the caller's stays its
 * own; `undefined` for none, or for one sent another way (a stream).
 */
function bodyBytes(body: BodyInit | null | undefined): Uint8Array | undefined {
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    return undefined;
}

/** A unit a hold parks before it runs: what sends it on, and what settles once it has run. */
interface ParkedUnit {
    /** Sends it on to its worker. */
    readonly go: () => void;
    /** Settles once its worker has answered it, or ended with it parked. */
    readonly ran: Promise<void>;
    /** Settles {@link ran}. */
    readonly end: () => void;
}

/** A hold on units: whether it holds what comes, what it parks — the oldest first — and who waits for it to park one. */
interface UnitHoldState {
    live: boolean;
    readonly parked: ParkedUnit[];
    readonly heldNow: () => void;
    readonly waiters: (() => void)[];
}

/** Unit workers whose units a test may hold before they run: what {@link TestE3.holdUnits} holds. */
interface HeldUnits {
    /** Starts a unit worker: `serveE3`'s `units`. */
    readonly start: () => UnitWorker;
    /** Holds each unit sent from now on. */
    hold(): E3UnitHold;
    /** Lets every hold go, as a test ends. */
    reset(): void;
}

/**
 * Unit workers whose units a test may hold: each a worker `start` makes, its
 * `run` messages parked while a hold is live, and sent on as the test lets
 * them go — a unit e3 started, not yet begun. A worker's `done` or `broken`
 * for a unit sent on settles that unit's `ran`.
 *
 * @param start - Starts a unit worker: `inProcessUnits()`'s
 * @returns The workers' factory, and their holds
 */
function heldUnits(start: () => UnitWorker): HeldUnits {
    const holds: UnitHoldState[] = [];
    const letGo = (hold: UnitHoldState) => {
        hold.live = false;
        for (const unit of hold.parked.splice(0)) unit.go();
        for (const waiter of hold.waiters.splice(0)) waiter();
    };
    return {
        start: () => {
            const worker = start();
            // Each unit sent on, by its run's id: what settles once the worker answers it.
            const running = new Map<number, () => void>();
            const parkedHere = new Set<ParkedUnit>();
            const unit: UnitWorker = {
                onmessage: null,
                onerror: null,
                postMessage(message: HostMessage, transfer: Transferable[]) {
                    const hold = message.kind === "run" ? holds.find((candidate) => candidate.live) : undefined;
                    if (hold === undefined || message.kind !== "run") {
                        worker.postMessage(message, transfer);
                        return;
                    }
                    let end!: () => void;
                    const ran = new Promise<void>((resolve) => { end = resolve; });
                    const parked: ParkedUnit = {
                        go: () => {
                            parkedHere.delete(parked);
                            running.set(message.id, end);
                            worker.postMessage(message, transfer);
                        },
                        ran,
                        end,
                    };
                    parkedHere.add(parked);
                    hold.parked.push(parked);
                    hold.heldNow();
                    for (const waiter of hold.waiters.splice(0)) waiter();
                },
                terminate() {
                    // What the worker held, parked or running, never answers: each has run, for a test that waits on it.
                    for (const parked of parkedHere) {
                        for (const hold of holds) {
                            const at = hold.parked.indexOf(parked);
                            if (at >= 0) hold.parked.splice(at, 1);
                        }
                        parked.end();
                    }
                    parkedHere.clear();
                    for (const end of running.values()) end();
                    running.clear();
                    worker.terminate();
                },
            };
            worker.onmessage = (event: MessageEvent) => {
                const message = event.data as WorkerMessage;
                if (message.kind === "done" || message.kind === "broken") {
                    running.get(message.id)?.();
                    running.delete(message.id);
                }
                unit.onmessage?.(event);
            };
            worker.onerror = (event: ErrorEvent) => { unit.onerror?.(event); };
            return unit;
        },
        hold() {
            let heldNow!: () => void;
            const holding = new Promise<void>((resolve) => { heldNow = resolve; });
            const hold: UnitHoldState = { live: true, parked: [], heldNow, waiters: [] };
            holds.push(hold);
            return {
                get held() { return hold.parked.length; },
                holding,
                async releaseOne() {
                    while (hold.parked.length === 0) {
                        if (!hold.live) throw new Error("the hold has let go of its units: it holds none to release");
                        await new Promise<void>((resolve) => { hold.waiters.push(resolve); });
                    }
                    const parked = hold.parked.shift()!;
                    parked.go();
                    await parked.ran;
                },
                release: () => letGo(hold),
            };
        },
        reset() {
            for (const hold of holds.splice(0)) letGo(hold);
        },
    };
}

/** An answer as e3's API server sends a failure (`sendJsonError`): its status, and its error's type and message as JSON. */
function failureResponse(failure: Exclude<E3Failure, "network" | "lost">, request: E3Request): Response {
    const status = failure.status ?? 500;
    const type = failure.type ?? "internal";
    const message = failure.message ?? `the test failed ${request.method} ${request.path}`;
    return new Response(JSON.stringify({ error: { type, message } }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Starts e3 for a test file: e3-web in this process, the package of the
 * given example modules imported, deployed and its dataflow run once.
 *
 * @param modules - Each e3-ui example module the file mounts, by its key under e3-ui's `test/` (`calendar/calendar-records`), as the file imports it
 * @returns e3, ready for {@link TestE3.workspace}
 * @throws {Error} When a step fails, naming it: two modules declaring one definition, an import, a deploy, or a dataflow run that did not succeed
 */
export async function startTestE3(modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>): Promise<TestE3> {
    const zip = await examplesPackageZip(Object.entries(modules).map(([pathKey, exports]) => exampleModule(pathKey, exports)));
    const units = heldUnits(inProcessUnits());
    const { port1, port2 } = new MessageChannel();
    serveE3({ units: units.start, persist: false, pieceBytes: EXAMPLES_PIECE_BYTES }, port1);
    const web: WebE3 = await createWebE3(port2);
    try {
        const direct: RequestOptions = { token: null, fetch: web.fetch };
        await repoCreate(web.apiUrl, TEST_REPO, direct);
        const { name, version } = await packageImport(web.apiUrl, TEST_REPO, zip, direct);
        await workspaceCreate(web.apiUrl, TEST_REPO, DEPLOYED, direct);
        await workspaceDeploy(web.apiUrl, TEST_REPO, DEPLOYED, `${name}@${version}`, direct);
        const run = await dataflowExecute(web.apiUrl, TEST_REPO, DEPLOYED, {}, direct, { pollInterval: 10 });
        if (!run.success) {
            const failed = run.tasks.filter((task) => task.state.type === "error" || task.state.type === "failed").map((task) => task.name);
            throw new Error(`the examples' dataflow did not succeed: ${failed.join(", ") || "no task failed, but the run did not succeed"}`);
        }
        return testE3Over(web, units);
    } catch (err) {
        web.close();
        throw err;
    }
}

/** The harness over a started e3-web, whose units the given workers run. */
function testE3Over(web: WebE3, units: HeldUnits): TestE3 {
    const requests: E3Request[] = [];
    /** A hold: what it matches, whether it holds what comes, each request it parks — the oldest first — and who waits for its first. */
    const holds: { match: E3Match; live: boolean; parked: (() => void)[]; holdingNow: () => void }[] = [];
    const faults: { match: E3Match; failure: E3Failure }[] = [];
    /** Each tap a test set: what it matches, and the answers it keeps. */
    const taps: { match: E3Match; answers: E3Answer[] }[] = [];
    const idlers = new Set<() => void>();
    let inFlight = 0;
    let parked = 0;
    let started = 0;
    let copies = 0;

    const letGo = (hold: (typeof holds)[number]) => {
        hold.live = false;
        for (const go of hold.parked.splice(0)) go();
    };

    const tellIdle = () => {
        if (inFlight - parked !== 0) return;
        for (const idler of [...idlers]) idler();
    };

    /** The answer, kept by each tap that matches its request. */
    const kept = async (entry: E3Request, response: Response): Promise<Response> => {
        const tapped = taps.filter((tap) => tap.match(entry));
        if (tapped.length === 0) return response;
        const body = new Uint8Array(await response.clone().arrayBuffer());
        for (const tap of tapped) tap.answers.push({ request: entry, status: response.status, body });
        return response;
    };

    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const entry = e3RequestOf(request.method, new URL(request.url), request.headers, bodyBytes(init?.body), request.signal);
        requests.push(entry);
        started++;
        inFlight++;
        try {
            const hold = holds.find((candidate) => candidate.live && candidate.match(entry));
            if (hold !== undefined) {
                parked++;
                let go!: () => void;
                const released = new Promise<void>((resolve) => { go = resolve; });
                hold.parked.push(go);
                hold.holdingNow();
                tellIdle();
                try {
                    await Promise.race([released, aborted(request.signal)]);
                } finally {
                    parked--;
                    const at = hold.parked.indexOf(go);
                    if (at >= 0) hold.parked.splice(at, 1);
                }
            }
            const fault = faults.find((candidate) => candidate.match(entry));
            if (fault !== undefined) {
                if (fault.failure === "lost") {
                    await web.fetch(request);
                    throw new TypeError(`fetch failed: the test lost e3's answer to ${entry.method} ${entry.path}`);
                }
                if (fault.failure === "network") throw new TypeError(`fetch failed: the test failed the network for ${entry.method} ${entry.path}`);
                return await kept(entry, failureResponse(fault.failure, entry));
            }
            return await kept(entry, await web.fetch(request));
        } finally {
            inFlight--;
            tellIdle();
        }
    };
    const options: RequestOptions = { token: null, fetch };
    const direct: RequestOptions = { token: null, fetch: web.fetch };

    return {
        apiUrl: web.apiUrl,
        repo: TEST_REPO,
        fetch,
        options,
        direct,
        requests,
        async workspace() {
            const name = `test-${++copies}`;
            await workspaceCopy(web.apiUrl, TEST_REPO, DEPLOYED, name, direct);
            return name;
        },
        inFlight: () => inFlight,
        started: () => started,
        idle() {
            if (inFlight - parked === 0) return Promise.resolve();
            return new Promise<void>((resolve) => {
                const idler = () => {
                    idlers.delete(idler);
                    resolve();
                };
                idlers.add(idler);
            });
        },
        hold(match) {
            let holdingNow!: () => void;
            const holding = new Promise<void>((resolve) => { holdingNow = resolve; });
            const hold = { match, live: true, parked: [] as (() => void)[], holdingNow };
            holds.push(hold);
            return {
                get held() { return hold.parked.length; },
                holding,
                releaseOne: () => { hold.parked.shift()?.(); },
                releaseLast: () => { hold.parked.pop()?.(); },
                release: () => { hold.live = false; for (const go of hold.parked.splice(0)) go(); },
            };
        },
        answers(match) {
            const tap = { match, answers: [] as E3Answer[] };
            taps.push(tap);
            return tap.answers;
        },
        holdUnits: () => units.hold(),
        background(work) {
            inFlight++;
            const done = () => { inFlight--; tellIdle(); };
            work.then(done, done);
            return work;
        },
        fail(match, failure = {}) {
            const fault = { match, failure };
            faults.push(fault);
            return () => {
                const at = faults.indexOf(fault);
                if (at >= 0) faults.splice(at, 1);
            };
        },
        reset() {
            for (const hold of holds.splice(0)) letGo(hold);
            units.reset();
            faults.splice(0);
            taps.splice(0);
            requests.splice(0);
        },
        close() {
            for (const hold of holds.splice(0)) letGo(hold);
            units.reset();
            web.close();
        },
    };
}

/**
 * What e3 holds of a dataset or a record now, read through e3's API.
 *
 * @param e3 - e3 under test
 * @param workspace - The workspace
 * @param dataset - The dataset or record
 * @returns Its value, decoded
 */
export async function readDataset<T extends EastType>(e3: TestE3, workspace: string, dataset: E3Dataset<T>): Promise<ValueTypeOf<T>> {
    const { data } = await datasetGet(e3.apiUrl, e3.repo, workspace, dataset.path, e3.direct);
    return decodeBeast2For(dataset.type)(data);
}

/**
 * Writes a dataset as another session would, through e3's API.
 *
 * @param e3 - e3 under test
 * @param workspace - The workspace
 * @param dataset - The dataset
 * @param value - Its new value
 */
export async function writeDataset<T extends EastType>(e3: TestE3, workspace: string, dataset: E3Dataset<T>, value: ValueTypeOf<T>): Promise<void> {
    await datasetSet(e3.apiUrl, e3.repo, workspace, dataset.path, encodeBeast2For(dataset.type)(value), e3.direct);
}

/**
 * Commits a record's new state as another session would: the patch from
 * what e3 holds to the new state, through the record's patch mutation.
 *
 * @param e3 - e3 under test
 * @param workspace - The workspace
 * @param record - The record, which declares a patch mutation (`e3.mutation.patch`)
 * @param next - Its new state
 * @param mutation - The patch mutation's name; `patch` unless given
 * @returns What e3 answered
 * @throws {Error} When e3 does not commit it, naming what it answered
 */
export async function patchRecord<T extends EastType>(
    e3: TestE3, workspace: string, record: E3Record<T>, next: ValueTypeOf<T>, mutation = "patch",
): Promise<MutationResult> {
    const before = await readDataset(e3, workspace, record);
    const patch: unknown = diffFor(record.type)(before, next);
    const args = [encodeBeast2For(PatchType(record.type))(patch as never)];
    const result = await workspaceRecordMutate(e3.apiUrl, e3.repo, workspace, record.name, mutation,
        { args, actor: some("another session"), limits: none }, e3.direct);
    if (result.outcome.type !== "committed") throw new Error(`e3 did not commit the patch to ${record.name}: ${result.outcome.type}`);
    return result;
}

/**
 * A record's commits, newest first, read through e3's API.
 *
 * @param e3 - e3 under test
 * @param workspace - The workspace
 * @param record - The record
 * @returns Its history: each commit's mutation (`patch`, `$init`, …), its state, its actor and its time
 */
export async function recordHistory(e3: TestE3, workspace: string, record: { readonly name: string }): Promise<RecordHistoryResult> {
    return workspaceRecordHistory(e3.apiUrl, e3.repo, workspace, record.name, undefined, e3.direct);
}

/**
 * Runs a workspace's dataflow, as another session's run would: each task whose
 * inputs moved runs again.
 *
 * @param e3 - e3 under test
 * @param workspace - The workspace
 * @throws {Error} When the run does not succeed, naming the tasks that failed
 */
export async function runDataflow(e3: TestE3, workspace: string): Promise<void> {
    const run = await dataflowExecute(e3.apiUrl, e3.repo, workspace, {}, e3.direct, { pollInterval: 10 });
    if (!run.success) {
        const failed = run.tasks.filter((task) => task.state.type === "error" || task.state.type === "failed").map((task) => task.name);
        throw new Error(`the dataflow did not succeed: ${failed.join(", ") || "no task failed, but the run did not succeed"}`);
    }
}
