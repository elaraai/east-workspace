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
 * way, alone or beside a builder sharing its id. A run is e3's: a one-shot
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

import { StrictMode, type ReactNode } from "react";
import { fireEvent, screen, within, type RenderResult } from "@testing-library/react";
import { East, NullType, StringType, decodeBeast2For, encodeBeast2For, toEastTypeValue } from "@elaraai/east";
import { Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Query, Record, queryKeys } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { datasetGetStatus, oneShotExecute, splitCallExplain, splitCallStatus } from "@elaraai/e3-api-client";
import {
    ExecuteResultType, OneShotRequestType, PackageJobResponseType, ResponseType, SplitCallRequestType, SplitCallStatusType,
    type DatasetStatusDetail, type ExecuteResult, type OneShotRequest, type SplitCallPlan, type SplitCallRequest, type SplitCallStatus,
} from "@elaraai/e3-types";
import { act, e3Harness, settle, type E3Harness } from "../e3-web-mount.test-utils.js";
import type { E3Answer, E3Dataset, E3Match } from "../e3-web.test-utils.js";
import { queryRoot, type QueryRoot } from "./one-shot.js";
import { QueryOpenType, type QueryOpen } from "./open-query.js";
import type { SavedQuery } from "./session.js";
import { savedRecord, type Saved } from "./fixture.test-utils.js";
// The builder and the query library are extensions: their renderers register as they load.
import "./builder.js";
import "./library.js";

/** The `act` the query tests take: each scope its test's work, until it closes (#1280). */
export { act, settle };

/** The State a query library's `onOpen` writes the name it opened to, in the surface {@link QueryHarness.mountLibrary} mounts. */
export const TOLD = "query-library-test.told";

/** A one-shot call: what a run of one call, or a summary, sends. */
export const isRun: E3Match = (request) => request.kind === "one-shot";
/** A split call's launch (#941). */
export const isSplitLaunch: E3Match = (request) => request.kind === "split" && request.method === "POST" && request.query.get("explain") !== "1";
/** The launch of a split call's explain (#1132). */
export const isExplain: E3Match = (request) => request.kind === "split" && request.method === "POST" && request.query.get("explain") === "1";
/** A poll of a split call's job, or of an explain's: of one job's, when given. */
export const isPoll = (job?: string): E3Match => (request) => request.kind === "split" && request.method === "GET" && (job === undefined || request.name === job);

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
const readJob = decodeBeast2For(ResponseType(PackageJobResponseType));
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
 * Opens a query, as the query library does.
 *
 * @param open - The query to open
 */
export async function openQuery(open: QueryOpen) {
    await act(async () => { StateRuntime.getStore().write(queryKeys(undefined).query, encodeBeast2For(QueryOpenType)(open)); });
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
    /** The saved query the builder opens first, by name — its payload's `query`, which it runs as it mounts. */
    readonly query?: string;
    /** Mounts it under React's `StrictMode`, as the showcase does: mounted, unmounted and mounted again. */
    readonly strict?: boolean;
    /** The token its `E3Provider` gives e3 with every request. */
    readonly token?: string;
    /** What the host holds it in, inside e3's providers: its own calls, or plan options of its own, say. */
    readonly host?: (builder: ReactNode) => ReactNode;
}

/** How the query library is mounted. */
export interface LibraryOptions {
    /** The name the library and the builder share. */
    readonly id?: string;
    /** Mounts the builder beside it, sharing its id. */
    readonly builder?: boolean;
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
     * sources, under a line saying what it last told the host it opened
     * (`told Big orders`); with the builder beside it, sharing its id, when
     * asked; under a drag layer when asked.
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
 * @returns The harness
 */
export function queryHarness(): QueryHarness {
    const h = e3Harness({ "query/query": ex }, { measure: false });
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
            const opening = options.query === undefined ? {} : { query: options.query };
            const builder = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const saved = $.let(Record.bind(ex.queries, [ex.queriesPatch]));
                const orders = $.let(Data.bindPaged(ex.orders));
                const customers = $.let(Data.bind(ex.customers));
                return Query.Builder({ queries: saved, datasets: { orders, customers }, ...opening });
            }))) };
            return mountOver(builder, { drag: false, storageKey: "query-builder", ...paged(options), ...tokened(options.token) });
        },
        mountHistory: (options: BuilderOptions = {}) => {
            const opening = options.query === undefined ? {} : { query: options.query };
            const builder = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const saved = $.let(Record.bind(ex.historyQueries, [ex.historyQueriesPatch]));
                const history = $.let(Data.bindPaged(ex.historyTask));
                const accounts = $.let(Data.bindPaged(ex.accountsTask));
                const credit = $.let(Data.bindPaged(ex.creditTask));
                const customers = $.let(Data.bind(ex.customers));
                return Query.Builder({ queries: saved, datasets: { order_history: history, accounts, credit, customers }, ...opening });
            }))) };
            return mountOver(builder, { drag: false, storageKey: "query-history", ...paged(options), ...tokened(options.token) });
        },
        mountLibrary: (options: LibraryOptions = {}) => {
            const named = options.id === undefined ? {} : { id: options.id };
            const withBuilder = options.builder === true;
            const library = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const saved = $.let(Record.bind(ex.queries, [ex.queriesPatch]));
                const orders = $.let(Data.bindPaged(ex.orders));
                const customers = $.let(Data.bind(ex.customers));
                const told = $.let(State.bind([StringType], TOLD, "nothing"));
                const onOpen = $.const(East.function([StringType], NullType, ($2, name) => { $2(told.write(name)); }));
                const shelf = $.let(Query.Library({ queries: saved, datasets: { orders, customers }, onOpen, ...named }));
                const said = $.let(Text.Root(East.str`told ${told.read()}`));
                return withBuilder
                    ? Stack.VStack([said, shelf, Query.Builder({ queries: saved, datasets: { orders, customers }, ...named })])
                    : Stack.VStack([said, shelf]);
            }))) };
            return mountOver(library, { drag: options.drag === true, storageKey: "query-library" });
        },
        refuseRuns: () => h.e3.fail(isRun, { status: 500, type: "internal", message: "the test refused the run" }),
        oneShots: () => h.requests("one-shot").map((request) => readOneShot(sent(request))),
        oneShotResults: () => {
            const answers = h.e3.answers(isRun);
            return () => successes(readExecuted, answers);
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
