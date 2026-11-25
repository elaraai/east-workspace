/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's DOM test harness (#935, #936), on e3 itself (#1376): the
 * query examples deployed to e3-web (`query/query`), each test a workspace of
 * its own. A test's saved queries are the `queries` record as another
 * session's commit leaves them ({@link QueryHarness.seed}); the builder is
 * mounted over it as a surface mounts it — the orders paged, the customers
 * whole ({@link QueryHarness.mountBuilder}) — or over the order history the
 * examples' tasks generate, too large for one call
 * ({@link QueryHarness.mountHistory}); and the query library (#1063) the same
 * way, alone or beside a builder sharing its id. Each surface holds its open
 * query as a host does (#1668) — a State of its own ({@link OPEN}), given to
 * the builder and the query library as `query` and written when they ask for
 * another — which a test writes as the host would ({@link openQuery}). A run is e3's: a one-shot
 * call, or a split call e3 cuts into pieces as the showcase's e3 does (#941,
 * #1132). What a run sent is its request's body ({@link QueryHarness.oneShots},
 * {@link QueryHarness.splitCalls}); what e3 answered, a tap's
 * ({@link QueryHarness.oneShotResults}, {@link QueryHarness.splitResults}); a
 * fault, the harness's fetch's (`h.e3.hold`, `h.e3.fail`); and what a result
 * must equal, e3's own answer to the test's own call
 * ({@link QueryHarness.oneShot}, {@link QueryHarness.explain}).
 *
 * e3's execution cache is the file's, as its repository is: a split call one
 * test ran is served from the cache in the next, its units run no more. A test
 * whose run must be caught going — its units held — runs a program of its own.
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): a test file takes
 * `act` from here, never from Testing Library.
 *
 * @packageDocumentation
 */

import { StrictMode, useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { fireEvent, screen, within, type RenderResult } from "@testing-library/react";
import { East, NullType, StringType, decodeBeast2For, encodeBeast2For, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import {
    Reactive, RecordSlicesChromeType, Slice, Stack, State, Text, UIComponentType, recordSlicesChrome, type RecordSliceBindType,
} from "@elaraai/east-ui/internal";
import { StateRuntime, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Query, QueryOpenType, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { datasetGetStatus, oneShotExecute, splitCallExplain, splitCallStatus } from "@elaraai/e3-api-client";
import {
    ExecuteResultType, FunctionCallAnswerType, FunctionCallStatusType, OneShotRequestType, PackageJobResponseType, ResponseType, SplitCallRequestType,
    SplitCallStatusType,
    type DatasetStatusDetail, type ExecuteResult, type FunctionCallStatus, type OneShotRequest, type SplitCallPlan, type SplitCallRequest,
    type SplitCallStatus,
} from "@elaraai/e3-types";
import { act, e3Harness, settle, type E3Harness } from "../e3-web-mount.test-utils.js";
import type { E3Answer, E3Dataset, E3Match } from "../e3-web.test-utils.js";
import { queryRoot, type QueryRoot } from "./one-shot.js";
import type { QueryOpen } from "./open-query.js";
import { queryEast } from "./query-east.js";
import type { SavedQuery } from "./session.js";
import { savedRecord, type Saved } from "./fixture.test-utils.js";
// The builder and the query library are extensions: their renderers register as they load.
import "./builder.js";
import "./library.js";

/** The `act` the query tests take: each scope its test's work, until it closes (#1280). */
export { act, settle };

/** The key of the rail the surface {@link QueryHarness.mountLibrary} mounts narrows its saved queries by. */
export const LIBRARY_RAIL = "query-library.rail";

/** That rail's one source: the saved queries, read a window at a time through the record's indexes. */
const librarySources = () => ({
    rows: {
        source: Data.bindPaged(ex.queries, { indexes: ["queries_by_source", "queries_by_tag", "queries_by_name", "queries_by_saved_at"] }),
        label: "Queries", range: "saved_at" as const, search: ["name", "sources", "tags"] as const,
        fields: { name: { label: "Name" }, sources: { label: "Data source" }, tags: { label: "Tag" }, saved_at: { label: "Saved" } },
    },
});

/** The rail, as a test writes it: the same source under the library's key, its controls as the toolbar's chips use them. */
const libraryRailChrome = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: Slice.bindRecords(LIBRARY_RAIL, librarySources()) }))),
    getRegisteredPlatformImplementations());

/**
 * The `rows` source's part of the mounted library's rail: what a test chooses a field's values through, as a chip does.
 *
 * @returns Its controls
 */
export function libraryRail(): ValueTypeOf<RecordSliceBindType> {
    return libraryRailChrome().slice.parts.find((part) => part.source === "rows")!.slice;
}

/**
 * The State a query library's `onOpen` writes what it was told to, in the
 * surface {@link QueryHarness.mountLibrary} mounts: a saved query's name, the
 * name of the run a new query begins as, or `a new query on <data source>`.
 */
export const TOLD = "query-library-test.told";

/** The State a test's surface holds its open query in, as a host does: what its builder and its query library are given. */
export const OPEN = "query-test.open";

/** The entry a query library and a builder once shared by id: nothing writes it (#1668). */
export const sharedEntry = () => StateRuntime.getStore().read("query.builder.query");

const encodeOpen = encodeBeast2For(QueryOpenType);
const decodeOpen = decodeBeast2For(QueryOpenType);

/** A new query on a data source, as a builder given no query begins: what a surface that names none holds to begin with. */
export const firstQuery = (source: string): QueryOpen => queryEast().openOn(source);

/**
 * The open query the test's surface holds, if one is mounted.
 *
 * @returns The open query, as its host's State holds it
 */
export function hostQuery(): QueryOpen | undefined {
    const bytes = StateRuntime.getStore().read(OPEN);
    return bytes === undefined ? undefined : decodeOpen(bytes);
}

/**
 * The open query a host holds, for a test that renders a part of the builder
 * itself: what {@link openQuery} writes, and a write of its own.
 *
 * @param first - The query it holds before any is written
 * @returns The open query, and what opens another
 */
export function useHostQuery(first: QueryOpen): [QueryOpen, (next: QueryOpen) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(OPEN, notify), [store]);
    const snapshot = useCallback(() => store.read(OPEN), [store]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const open = useMemo(() => (bytes === undefined ? first : decodeOpen(bytes)), [bytes, first]);
    const write = useCallback((next: QueryOpen) => { store.write(OPEN, encodeOpen(next)); }, [store]);
    return [open, write];
}

/**
 * A one-shot call: what a run of one call sends, started as a call of the
 * workspace (`…/one-shot/calls`), or a summary within one request
 * (`…/one-shot`).
 */
export const isRun: E3Match = (request) => request.kind === "one-shot";
/** A run's one-shot call's start: what a run of one call sends, kept as a call of the workspace. */
export const isRunStart: E3Match = (request) => request.kind === "one-shot" && request.path.endsWith("/one-shot/calls");
/** A poll of a kept call: what a run of one call asks until its call ends. */
export const isCallPoll: E3Match = (request) =>
    request.method === "GET" && /^\/repos\/[^/]+\/workspaces\/[^/]+\/calls\/[^/]+\/status$/.test(request.path);
/** A split call's launch (#941): a POST that names no job. */
export const isSplitLaunch: E3Match = (request) => request.kind === "split" && request.method === "POST" && request.name === undefined && request.query.get("explain") !== "1";
/** The launch of a split call's explain (#1132). */
export const isExplain: E3Match = (request) => request.kind === "split" && request.method === "POST" && request.name === undefined && request.query.get("explain") === "1";
/** A poll of a split call's job, or of an explain's: of one job's, when given. */
export const isPoll = (job?: string): E3Match => (request) => request.kind === "split" && request.method === "GET" && (job === undefined || request.name === job);
/** The cancel of a split call's job, or of an explain's (#1104): of one job's, when given. */
export const isCancel = (job?: string): E3Match => (request) =>
    request.kind === "split" && request.method === "POST" && request.name !== undefined && (job === undefined || request.name === job);

/**
 * The root the history builder's data sources give ({@link QueryHarness.mountHistory}): the
 * order history, the accounts and their credit limits as the examples' tasks generate them,
 * and the fixture's customers — what a test prepares its own calls over.
 */
export const HISTORY_ROOT: QueryRoot = queryRoot([
    { name: "order_history", path: ex.historyTask.output.path, type: toEastTypeValue(ex.historyTask.output.type) },
    { name: "accounts", path: ex.accountsTask.output.path, type: toEastTypeValue(ex.accountsTask.output.type) },
    { name: "credit", path: ex.creditTask.output.path, type: toEastTypeValue(ex.creditTask.output.type) },
    { name: "customers", path: ex.customers.path, type: toEastTypeValue(ex.customers.type) },
]);

const readOneShot = decodeBeast2For(OneShotRequestType);
const readSplit = decodeBeast2For(SplitCallRequestType);
const readExecuted = decodeBeast2For(ResponseType(ExecuteResultType));
const readStarted = decodeBeast2For(ResponseType(FunctionCallAnswerType));
const readCallStatus = decodeBeast2For(ResponseType(FunctionCallStatusType));
const readJob = decodeBeast2For(ResponseType(PackageJobResponseType));

/** A kept call's result, once its status says it completed. */
function completedResult(status: FunctionCallStatus): ExecuteResult[] {
    return status.type === "completed" ? [status.value] : [];
}
const readSplitStatus = decodeBeast2For(ResponseType(SplitCallStatusType));

/** The body a request sent, which the route's type decodes. */
function sent(request: { readonly body: Uint8Array | undefined; readonly path: string }): Uint8Array {
    if (request.body === undefined) throw new Error(`${request.path} sent no body`);
    return request.body;
}

/**
 * The values of a route's answers that came: each one e3 answered with a
 * success, read by the route's type — a failure a fault answered with, or
 * e3's refusal, is not one.
 */
function successes<T>(read: (bytes: Uint8Array) => { type: "success"; value: T } | { type: "error"; value: unknown }, answers: readonly E3Answer[]): T[] {
    return answers.flatMap((answer) => {
        if (answer.status !== 200) return [];
        const response = read(answer.body);
        return response.type === "success" ? [response.value] : [];
    });
}

/**
 * Opens a query, as the builder's host does: it writes the open query it holds.
 *
 * @param open - The query to open
 */
export async function openQuery(open: QueryOpen) {
    await act(async () => { StateRuntime.getStore().write(OPEN, encodeOpen(open)); });
    await settle();
}

/**
 * Presses a button by its name, as a pointer does.
 *
 * @param name - Its accessible name
 * @param container - Where to find it; the document by default
 */
export async function press(name: string, container?: HTMLElement) {
    const button = (container === undefined ? screen : within(container)).getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/**
 * Whether a button, by its name, is on.
 *
 * @param name - Its accessible name
 * @returns Whether it can be pressed
 */
export const enabled = (name: string) => !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

/** How a builder is mounted. */
export interface BuilderOptions {
    /** The saved query its host holds as open to begin with, by name, which the builder runs as it mounts; a new query on the first data source unless given. */
    readonly query?: string;
    /** Mounts it given no query and no one to tell: it holds its own open query. */
    readonly own?: boolean;
    /** Mounts it under React's `StrictMode`, as the showcase does: mounted, unmounted and mounted again. */
    readonly strict?: boolean;
    /** The token its `E3Provider` gives e3 with every request. */
    readonly token?: string;
    /** What the host holds it in, inside e3's providers: its own calls, or plan options of its own, say. */
    readonly host?: (builder: ReactNode) => ReactNode;
}

/** How the query library is mounted. */
export interface LibraryOptions {
    /** The name the library and the builder beside it are given. */
    readonly id?: string;
    /** Mounts the builder too, as a surface of its own beside the library's, sharing its id and shown the same open query. */
    readonly builder?: boolean;
    /** Gives it no open query to mark: `false`; the surface's open query unless given. */
    readonly marked?: boolean;
    /** Under the page's drag layer, as a surface whose cards drag is. */
    readonly drag?: boolean;
}

/** What a query test reads, writes and mounts through: e3, the saved queries on it, and the builders and libraries over them. */
export interface QueryHarness extends E3Harness {
    /**
     * Commits the saved queries record as another session would, then
     * settles: the test's saved queries, before its builder mounts, or
     * another operator's save under it.
     *
     * @param queries - The saved queries, as the commit leaves them
     */
    seed(queries: readonly SavedQuery[]): Promise<void>;
    /** What e3 holds of the saved queries now. */
    saved(): Promise<Saved>;
    /** The saved queries' commits, newest first, by the mutation that made each. */
    commits(): Promise<string[]>;
    /**
     * Commits the order history's saved queries record as another session
     * would, then settles: what the history builder opens
     * ({@link QueryHarness.mountHistory}).
     *
     * @param queries - The saved queries, as the commit leaves them
     */
    seedHistory(queries: readonly SavedQuery[]): Promise<void>;
    /**
     * The builder over the saved queries, as a surface mounts it: the record
     * bound with its patch door, the orders paged and the customers whole.
     *
     * @param options - The query it opens first, `StrictMode`, its token
     * @returns The render
     */
    mountBuilder(options?: BuilderOptions): Promise<RenderResult>;
    /**
     * The builder over the order history's saved queries and the three
     * datasets the examples' tasks generate — the order history, the accounts
     * that place it and their credit limits — each paged, and each of more
     * than e3's smallest piece here: a query over them runs as a split call;
     * and the fixture's customers, whole, within one piece ({@link HISTORY_ROOT}).
     *
     * @param options - The query it opens first, `StrictMode`, its token
     * @returns The render
     */
    mountHistory(options?: BuilderOptions): Promise<RenderResult>;
    /**
     * The query library over the saved queries and the same two data
     * sources, under a line saying what it last told the host was asked for
     * (`told Big orders`), which the surface holds as its open query; with the
     * builder beside it, sharing its id and shown that query, when asked;
     * under a drag layer when asked.
     *
     * @param options - The id, the builder, the drag layer
     * @returns The render
     */
    mountLibrary(options?: LibraryOptions): Promise<RenderResult>;
    /**
     * Refuses every one-shot call from now, as e3 refuses a call it cannot
     * run (`500`, `internal`): a run that gives no result, for a test of what
     * the builder shows of a query rather than of its runs.
     *
     * @returns What stops it
     */
    refuseRuns(): () => void;
    /** Each one-shot call the test's surfaces sent so far, in order, as its body says. */
    oneShots(): OneShotRequest[];
    /** Keeps e3's answer to each one-shot call from now: each result it answered, in the order they came. */
    oneShotResults(): () => ExecuteResult[];
    /** Each split call the test's surfaces launched so far, in order, as its body says. */
    splitCalls(): SplitCallRequest[];
    /** Each split call the test's surfaces had explained so far, in order, as its body says (#1132). */
    explains(): SplitCallRequest[];
    /** Keeps e3's answer to each split call's and explain's launch from now: the job each started, in the order they came. */
    jobs(): () => string[];
    /** Keeps e3's answer to each split call's launch from now: the job each started, in the order the launches were sent. */
    splitJobs(): () => string[];
    /** Keeps e3's answer to each explain's launch from now: the job each started, in the order the launches were sent (#1132). */
    explainJobs(): () => string[];
    /** Keeps e3's answer to each poll from now: each job's id and what the poll found, in the order they came. */
    splitResults(): () => { readonly job: string; readonly status: SplitCallStatus }[];
    /**
     * Settles once e3 says a split call's or an explain's job has ended, as
     * the test polls it itself: what a test waits on to have the job's next
     * poll find it ended — a call that answered before e3 said how many pieces
     * it cut.
     *
     * @param job - The job's id
     */
    jobEnded(job: string): Promise<void>;
    /**
     * A dataset's status, as e3 answers the test itself.
     *
     * @param dataset - The dataset
     * @returns Its status: its hash, what it weighs, its rows
     */
    statusOf(dataset: E3Dataset): Promise<DatasetStatusDetail>;
    /**
     * A one-shot call the test makes itself, in its workspace: what a run's
     * result must equal.
     *
     * @param request - The call
     * @returns e3's result
     */
    oneShot(request: OneShotRequest): Promise<ExecuteResult>;
    /**
     * A split call's pieces, as e3 plans them for the test itself: what a
     * run's read-out must count.
     *
     * @param request - The call
     * @returns e3's plan
     */
    explain(request: SplitCallRequest): Promise<SplitCallPlan>;
}

/**
 * Installs the harness around each test of the file: e3 with the query
 * examples deployed, started once, and a workspace of its own for each test.
 *
 * @param options - `measure`: whether the builders' viewports and rows are measured as a browser lays them — what the
 *   query library's table, read a window at a time, draws its rows by; `false` unless given, as the builder measures none
 * @returns The harness
 */
export function queryHarness(options: { readonly measure?: boolean } = {}): QueryHarness {
    const h = e3Harness({ "query/query": ex }, { measure: options.measure === true });
    const mountOver = h.mount;
    /** The page around the builder: under `StrictMode` when asked, and in the host's own providers, inside e3's. */
    const paged = ({ strict, host }: BuilderOptions) => ({
        ...(strict === true && { wrap: (page: ReactNode) => <StrictMode>{page}</StrictMode> }),
        ...(host !== undefined && { host }),
    });
    const tokened = (token: string | undefined) => (token === undefined ? {} : { token });
    /** The jobs the launches a match takes started, in the order the launches were sent. */
    const launched = (match: E3Match) => {
        const answers = h.e3.answers(match);
        return () => successes(readJob, [...answers].sort((a, b) => h.e3.requests.indexOf(a.request) - h.e3.requests.indexOf(b.request))).map((job) => job.id);
    };
    return Object.assign(h, {
        seed: (queries: readonly SavedQuery[]) => h.patch(ex.queries, savedRecord(queries)),
        saved: () => h.read(ex.queries),
        commits: async () => (await h.history(ex.queries)).commits.map((commit) => commit.mutation),
        seedHistory: (queries: readonly SavedQuery[]) => h.patch(ex.historyQueries, savedRecord(queries)),
        mountBuilder: (options: BuilderOptions = {}) => {
            const builder = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const saved = $.let(Record.bind(ex.queries, ["patch"]));
                const orders = $.let(Data.bindPaged(ex.orders));
                const customers = $.let(Data.bind(ex.customers));
                if (options.own === true) return Query.Builder({ queries: saved, datasets: { orders, customers } });
                const open = $.let(State.bind([QueryOpenType], OPEN, options.query === undefined ? firstQuery("orders") : variant("saved", options.query)));
                const go = $.const(East.function([QueryOpenType], NullType, ($2, next) => { $2(open.write(next)); }));
                return Query.Builder({ queries: saved, datasets: { orders, customers }, query: open.read(), onOpen: go });
            }))) };
            return mountOver(builder, { drag: false, storageKey: "query-builder", ...paged(options), ...tokened(options.token) });
        },
        mountHistory: (options: BuilderOptions = {}) => {
            const builder = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const saved = $.let(Record.bind(ex.historyQueries, ["patch"]));
                const history = $.let(Data.bindPaged(ex.historyTask));
                const accounts = $.let(Data.bindPaged(ex.accountsTask));
                const credit = $.let(Data.bindPaged(ex.creditTask));
                const customers = $.let(Data.bind(ex.customers));
                const open = $.let(State.bind([QueryOpenType], OPEN, options.query === undefined ? firstQuery("order_history") : variant("saved", options.query)));
                const go = $.const(East.function([QueryOpenType], NullType, ($2, next) => { $2(open.write(next)); }));
                return Query.Builder({ queries: saved, datasets: { order_history: history, accounts, credit, customers }, query: open.read(), onOpen: go });
            }))) };
            return mountOver(builder, { drag: false, storageKey: "query-history", ...paged(options), ...tokened(options.token) });
        },
        mountLibrary: (options: LibraryOptions = {}) => {
            const named = options.id === undefined ? {} : { id: options.id };
            const withBuilder = options.builder === true;
            const library = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const orders = $.let(Data.bindPaged(ex.orders));
                const customers = $.let(Data.bind(ex.customers));
                // The surface holds the open query, as a host does: told of another, it writes it, and says what it was told.
                const open = $.let(State.bind([QueryOpenType], OPEN, firstQuery("orders")));
                const told = $.let(State.bind([StringType], TOLD, "nothing"));
                const onOpen = $.const(East.function([QueryOpenType], NullType, ($2, next) => {
                    $2(open.write(next));
                    $2(told.write(next.match({
                        saved: (_$3, name) => name,
                        new: (_$3, started) => started.from.match({
                            some: (_$4, run) => run.name,
                            none: (_$4) => East.str`a new query on ${started.source}`,
                        }),
                    })));
                }));
                // The saved queries, read a window at a time through the record's indexes, and the rail that narrows them.
                const slice = $.let(Slice.bindRecords(LIBRARY_RAIL, librarySources()));
                const shelf = $.let(options.marked === false
                    ? Query.Library({ datasets: { orders, customers }, onOpen, slice: { slice }, ...named })
                    : Query.Library({ datasets: { orders, customers }, query: open.read(), onOpen, slice: { slice }, ...named }));
                const said = $.let(Text.Root(East.str`told ${told.read()}`));
                return Stack.VStack([said, shelf]);
            }))) };
            // The builder is a surface of its own, as a host's is (#1761): the library pages the saved queries, which a
            // surface that pages a record never loads whole (#1199), and the builder reads them whole. The two share the
            // open query, which the host's State holds.
            const builder = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const saved = $.let(Record.bind(ex.queries, ["patch"]));
                const orders = $.let(Data.bindPaged(ex.orders));
                const customers = $.let(Data.bind(ex.customers));
                const open = $.let(State.bind([QueryOpenType], OPEN, firstQuery("orders")));
                const go = $.const(East.function([QueryOpenType], NullType, ($2, next) => { $2(open.write(next)); }));
                return Query.Builder({ queries: saved, datasets: { orders, customers }, query: open.read(), onOpen: go, ...named });
            }))) };
            const mounted = mountOver(library, { drag: options.drag === true, storageKey: "query-library" });
            return withBuilder ? mounted.then(async (shelf) => { await mountOver(builder, { drag: false, storageKey: "query-builder" }); return shelf; }) : mounted;
        },
        refuseRuns: () => h.e3.fail(isRun, { status: 500, type: "internal", message: "the test refused the run" }),
        oneShots: () => h.requests("one-shot").map((request) => readOneShot(sent(request))),
        oneShotResults: () => {
            // A summary's result is its answer; a run's, its start's when the call ended within it, else its poll's
            const answers = h.e3.answers((request) => isRun(request) || isCallPoll(request));
            return () => answers.flatMap((answer) => {
                if (isCallPoll(answer.request)) return successes(readCallStatus, [answer]).flatMap(completedResult);
                if (isRunStart(answer.request)) return successes(readStarted, [answer]).flatMap((started) => completedResult(started.status));
                return successes(readExecuted, [answer]);
            });
        },
        splitCalls: () => h.requests("split").filter(isSplitLaunch).map((request) => readSplit(sent(request))),
        explains: () => h.requests("split").filter(isExplain).map((request) => readSplit(sent(request))),
        jobs: () => {
            const answers = h.e3.answers((request) => isSplitLaunch(request) || isExplain(request));
            return () => successes(readJob, answers).map((job) => job.id);
        },
        splitJobs: () => launched(isSplitLaunch),
        explainJobs: () => launched(isExplain),
        splitResults: () => {
            const answers = h.e3.answers(isPoll());
            return () => answers.flatMap((answer) => successes(readSplitStatus, [answer]).map((status) => ({ job: answer.request.name!, status })));
        },
        jobEnded: async (job: string) => {
            for (;;) {
                const status = await splitCallStatus(h.e3.apiUrl, h.e3.repo, h.workspace, job, h.e3.direct);
                if (status.type !== "processing") return;
                await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
            }
        },
        statusOf: (dataset: E3Dataset) => datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, dataset.path, h.e3.direct),
        oneShot: (request: OneShotRequest) => oneShotExecute(h.e3.apiUrl, h.e3.repo, h.workspace, request, h.e3.direct),
        explain: (request: SplitCallRequest) => splitCallExplain(h.e3.apiUrl, h.e3.repo, h.workspace, request, h.e3.direct),
    });
}
