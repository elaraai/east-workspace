/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's hooks (#935) — what its surfaces use to resolve the
 * root, make a one-shot call and summarise a query, and to keep this viewer's
 * recent runs. A run is `run.ts`'s (#938).
 *
 * - **The root** (`useQueryRoot`): each bound data source as a root field —
 *   its name, its dataset's path and its value's type — in the order given.
 * - **The call** (`useQueryCall`): how a one-shot call is made — e3-api-client's
 *   `oneShotExecute` against the `E3Provider`'s server, or a host's own
 *   ({@link QueryCallProvider}).
 * - **The split call** (`useQuerySplitCall`, #941): how a split call is made —
 *   e3-api-client's `splitCall` against the `E3Provider`'s server, which
 *   launches it, polls it with backoff and reports its progress; or a host's
 *   own ({@link QuerySplitCallProvider}). And how its pieces are counted when
 *   a run answered before e3 reported them (`useQuerySplitExplain`, #1132):
 *   e3-api-client's `splitCallExplain`, or the host's own beside its split
 *   call.
 * - **A data source's status** (`useQuerySourceStatus`, #941): what it weighs
 *   and how many rows it holds, which a run reads before it plans — e3's
 *   dataset status, through the query the Datasets tab polls; or a host's own
 *   ({@link QuerySourceStatusProvider}).
 * - **The plan's options** (`useQueryPlanOptions`, #941): the most a dataset
 *   may weigh and still be read by one call ({@link QueryPlanOptionsProvider}).
 * - **Summaries** (`useQuerySummaries`): #934's summary programs, run the same
 *   way, kept by prefix and the hashes of what they read.
 * - **Recent runs** (`useRecentQueries`): this viewer's last ten, kept in the
 *   browser under the builder's key.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import {
    ArrayType, SummaryType, decodeBeast2, equalFor, isValueOf, parseFor, printFor, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { DataSourceType, SavedQueryType } from "@elaraai/e3-ui/internal";
import { datasetGetStatus, oneShotExecute, splitCall, splitCallExplain, type SplitCallAnswer } from "@elaraai/e3-api-client";
import {
    pathToString,
    type DatasetStatusDetail, type ExecuteResult, type OneShotRequest, type SplitCallPlan, type SplitCallProgress, type SplitCallRequest, type TreePath,
} from "@elaraai/e3-types";
import { useDataStable, usePersistedState } from "@elaraai/east-ui-components";
import { e3RequestOptions, useE3ConfigOptional, type E3Config } from "../platform/e3-config.js";
import { pagedSourceOf } from "../platform/paged-runtime.js";
import { SUMMARY_LIMITS, SummaryCache, type Summary, type SummaryRequest } from "./model/summaries.js";
import type { QueryWords } from "./model/words.js";
import { prepareQuery, queryResultOf, queryRoot, type QueryRoot, type QueryRootEntry } from "./one-shot.js";
import type { PlanOptions } from "./plan.js";

/** A data source the builder is handed. */
export type DataSource = ValueTypeOf<typeof DataSourceType>;
/** A saved query, or a recent run of one. */
type SavedQuery = ValueTypeOf<typeof SavedQueryType>;

const sourcesEqual = equalFor(ArrayType(DataSourceType));
const printSaved = printFor(SavedQueryType);
const parseSaved = parseFor(SavedQueryType);
const savedEqual = equalFor(SavedQueryType);

// ============================================================================
// The root
// ============================================================================

/**
 * The root a builder's queries read: each bound data source as a root field,
 * in the order given — or why it cannot be queried, in the builder's words.
 *
 * @remarks
 * A `Data.bind` source is its dataset's path, a record `[records, name]`, and a
 * `Data.bindPaged` source the path its handle was bound with, which the paged
 * runtime that built it holds. A paged source read through one of a record's
 * indexes is refused: its rows are the index's, not the record's a query reads.
 *
 * @param datasets - The data sources, as the payload holds them
 * @param words - The words, for a refusal
 * @returns The root, or the refusal
 */
export function useQueryRoot(datasets: DataSource[], words: QueryWords): QueryRoot | string {
    // The sources' identity is their data: a new payload with the same sources keeps the root.
    const stable = useDataStable(datasets, sourcesEqual);
    const m = words.messages;
    return useMemo(() => resolveRoot(stable, m), [stable, m]);
}

/** The root of the data sources, or the first reason one cannot be queried. */
function resolveRoot(datasets: readonly DataSource[], m: QueryWords["messages"]): QueryRoot | string {
    const entries: QueryRootEntry[] = [];
    for (const source of datasets) {
        let path: TreePath;
        switch (source.source.type) {
            case "value":
                path = source.source.value;
                break;
            case "record":
                path = [variant("field", "records"), variant("field", source.source.value)];
                break;
            case "paged": {
                const bound = pagedSourceOf(source.source.value);
                if (bound === undefined) return m.sourceUnbound({ name: source.name });
                if (bound.selector.index !== null) return m.sourceThroughIndex({ name: source.name, index: bound.selector.index });
                path = bound.path;
                break;
            }
        }
        entries.push({ name: source.name, path, type: source.type });
    }
    try {
        return queryRoot(entries);
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

// ============================================================================
// The call
// ============================================================================

/**
 * Makes a one-shot call: the request, answered by the call's result.
 *
 * @param request - The request — a query's or a summary's, platform-free
 * @returns The result
 */
export type QueryCall = (request: OneShotRequest) => Promise<ExecuteResult>;

const QueryCallContext = createContext<QueryCall | null>(null);

/** Props of {@link QueryCallProvider}. */
export interface QueryCallProviderProps {
    /** How a one-shot call is made for the subtree. */
    call: QueryCall;
    /** The subtree. */
    children?: ReactNode;
}

/**
 * Makes the query builder's one-shot calls with a host's own function — a
 * test's, or a host that reaches e3 another way.
 *
 * @param props - The call and the subtree
 * @returns The provider
 */
export function QueryCallProvider({ call, children }: QueryCallProviderProps) {
    return createElement(QueryCallContext.Provider, { value: call }, children);
}

/**
 * How the builder makes a one-shot call: a {@link QueryCallProvider}'s, else
 * e3-api-client's `oneShotExecute` against the `E3Provider`'s server and
 * workspace, with its token and through its `fetch`.
 *
 * @returns The call, or `undefined` when there is no server to call
 */
export function useQueryCall(): QueryCall | undefined {
    const provided = useContext(QueryCallContext);
    const config = useE3ConfigOptional();
    return useMemo((): QueryCall | undefined => {
        if (provided !== null) return provided;
        if (config === null || config.workspace === undefined) return undefined;
        const { apiUrl, workspace } = config;
        const repo = config.repo ?? "default";
        return (request) => oneShotExecute(apiUrl, repo, workspace, request, e3RequestOptions(config));
    }, [provided, config]);
}

// ============================================================================
// The split call (#941)
// ============================================================================

/** What a split call is given: the signal that abandons it, and where its progress goes. */
export interface QuerySplitCallOptions {
    /** Abandons the call: it stops polling, and rejects with the signal's reason. Its job runs on. */
    readonly signal: AbortSignal;
    /** Told the call's progress each time e3 reports it: its stage, and the units of it done of all. */
    readonly onProgress: (progress: SplitCallProgress) => void;
}

/**
 * Makes a split call: the request, answered once its job ends by the call's
 * result — read as a one-shot call's is — and the hash of its assembled
 * output, which a re-keyed join's second call reads (#942).
 *
 * @param request - The request — a plan's, platform-free (`splitCallRequest`,
 *   `rekeyCallRequests`)
 * @param options - The signal that abandons it, and where its progress goes
 * @returns The call's result, and its assembled output's hash once its pieces
 *   ran (`null` before)
 *
 * @remarks
 * It rejects with e3-api-client's `ApiError` or `AuthError` when the server
 * refuses the call, with a `TypeError` when the server cannot be reached, as
 * `fetch` does, and with any other error when e3 could not run it (a job that
 * ended `failed`); and with the signal's reason once it is abandoned.
 */
export type QuerySplitCall = (request: SplitCallRequest, options: QuerySplitCallOptions) => Promise<SplitCallAnswer>;

/**
 * Plans a split call's pieces without running it: e3's explain, a job that
 * plans them as the call's run plans them and runs no unit, so the count is
 * the run's (#1132).
 *
 * @param request - The call, as its run sent it
 * @param options - The signal that abandons it
 * @returns How many pieces, the argument they are cut over, by its position,
 *   and what that argument weighs in the store
 *
 * @remarks
 * It rejects as a split call does ({@link QuerySplitCall}), and with an
 * `Error` naming what is wrong when e3 finds the call wrong.
 */
export type QuerySplitExplain = (request: SplitCallRequest, options: { readonly signal: AbortSignal }) => Promise<SplitCallPlan>;

const QuerySplitCallContext = createContext<QuerySplitCall | null>(null);
const QuerySplitExplainContext = createContext<QuerySplitExplain | null>(null);

/** Props of {@link QuerySplitCallProvider}. */
export interface QuerySplitCallProviderProps {
    /** How a split call is made for the subtree. */
    call: QuerySplitCall;
    /**
     * How the subtree's split calls' pieces are counted when a run answered
     * before its call reported them (#1132): the in-memory call's `explain`,
     * say. Without it, such a run's pieces go uncounted.
     */
    explain?: QuerySplitExplain;
    /** The subtree. */
    children?: ReactNode;
}

/**
 * Makes the query builder's split calls with a host's own function — a
 * test's (`createInMemorySplitCall`), or a host that reaches e3 another way —
 * and counts their pieces with the host's explain, when it gives one.
 *
 * @param props - The call, its explain and the subtree
 * @returns The provider
 */
export function QuerySplitCallProvider({ call, explain, children }: QuerySplitCallProviderProps) {
    return createElement(QuerySplitCallContext.Provider, { value: call },
        createElement(QuerySplitExplainContext.Provider, { value: explain ?? null }, children));
}

/**
 * How the builder makes a split call: a {@link QuerySplitCallProvider}'s, else
 * e3-api-client's `splitCall` against the `E3Provider`'s server and workspace,
 * with its token and through its `fetch`, which launches the call, polls it —
 * 100 ms apart at first, backing off to a second — and reports each progress
 * it finds.
 *
 * @returns The call, or `undefined` when there is no server to call
 */
export function useQuerySplitCall(): QuerySplitCall | undefined {
    const provided = useContext(QuerySplitCallContext);
    const config = useE3ConfigOptional();
    return useMemo((): QuerySplitCall | undefined => {
        if (provided !== null) return provided;
        if (config === null || config.workspace === undefined) return undefined;
        const { apiUrl, workspace } = config;
        const repo = config.repo ?? "default";
        return (request, { signal, onProgress }) => splitCall(apiUrl, repo, workspace, request, e3RequestOptions(config), { signal, onProgress });
    }, [provided, config]);
}

/**
 * How the builder counts a split call's pieces when its run answered before
 * e3 reported them (#1132): a {@link QuerySplitCallProvider}'s explain — a
 * host's split calls are explained by the host, or not at all — else
 * e3-api-client's `splitCallExplain` against the `E3Provider`'s server and
 * workspace, with its token and through its `fetch`, which launches the
 * explain and polls it until it has planned.
 *
 * @returns The explain, or `undefined` when there is none to make
 */
export function useQuerySplitExplain(): QuerySplitExplain | undefined {
    const host = useContext(QuerySplitCallContext);
    const provided = useContext(QuerySplitExplainContext);
    const config = useE3ConfigOptional();
    return useMemo((): QuerySplitExplain | undefined => {
        if (host !== null) return provided ?? undefined;
        if (config === null || config.workspace === undefined) return undefined;
        const { apiUrl, workspace } = config;
        const repo = config.repo ?? "default";
        return (request, { signal }) => splitCallExplain(apiUrl, repo, workspace, request, e3RequestOptions(config), { signal });
    }, [host, provided, config]);
}

// ============================================================================
// A data source's status (#941)
// ============================================================================

/** What e3's status says of a data source: how many rows it holds, its hash, and what it weighs. */
export interface SourceStatus {
    /** How many elements a stored list or lookup table holds; `undefined` for a value that is not a collection, or not known. */
    readonly rows: number | undefined;
    /** The hash of its value; `undefined` when it has none, or it is not known. */
    readonly hash: string | undefined;
    /** What its value weighs in the store, in bytes — a collection's segments and its manifest; `undefined` when not known. */
    readonly bytes: number | undefined;
}

/**
 * Reads a data source's status: what a run weighs before it plans.
 *
 * @param path - The dataset's path, as the root holds it
 * @returns Its status
 */
export type QuerySourceStatus = (path: TreePath) => Promise<SourceStatus>;

const QuerySourceStatusContext = createContext<QuerySourceStatus | null>(null);

/** Props of {@link QuerySourceStatusProvider}. */
export interface QuerySourceStatusProviderProps {
    /** How a data source's status is read for the subtree. */
    status: QuerySourceStatus;
    /** The subtree. */
    children?: ReactNode;
}

/**
 * Reads the data sources' statuses with a host's own function — a test's, or
 * a host's over datasets in memory (`createInMemorySourceStatus`).
 *
 * @param props - The status and the subtree
 * @returns The provider
 */
export function QuerySourceStatusProvider({ status, children }: QuerySourceStatusProviderProps) {
    return createElement(QuerySourceStatusContext.Provider, { value: status }, children);
}

/** How long a status a run reads stays fresh: as long as the Datasets tab waits to poll it again. */
const STATUS_FRESH_MS = 5_000;

/** A data source's status query, as TanStack Query takes it: its key, and its function. */
export interface SourceStatusQuery {
    /** Its key: the server, the repository, the workspace and the dataset's path. */
    readonly queryKey: readonly unknown[];
    /** Its function: e3-api-client's `datasetGetStatus`. */
    readonly queryFn: () => Promise<DatasetStatusDetail>;
}

/**
 * A data source's status query on e3, as TanStack Query takes it: the Datasets
 * tab polls it, and a run reads it through the same cache before it plans.
 *
 * @param config - The server: its token, and the `fetch` its requests go through
 * @param workspace - The workspace
 * @param path - The dataset's path
 * @returns The query's key, and its function: e3-api-client's `datasetGetStatus`
 */
export function sourceStatusQuery(config: E3Config, workspace: string, path: TreePath): SourceStatusQuery {
    const { apiUrl } = config;
    const repo = config.repo ?? "default";
    return {
        queryKey: ["querySourceStatus", apiUrl, repo, workspace, pathToString(path)],
        queryFn: () => datasetGetStatus(apiUrl, repo, workspace, path, e3RequestOptions(config)),
    };
}

/**
 * A data source's status, as e3's dataset status gives it.
 *
 * @param detail - The dataset's status detail
 * @returns Its rows, hash and stored bytes
 */
export function sourceStatusOf(detail: DatasetStatusDetail): SourceStatus {
    return {
        rows: detail.rows.type === "none" ? undefined : Number(detail.rows.value),
        hash: detail.hash.type === "none" ? undefined : detail.hash.value,
        bytes: detail.size.type === "none" ? undefined : Number(detail.size.value),
    };
}

/**
 * How the builder reads a data source's status: a
 * {@link QuerySourceStatusProvider}'s, else e3's dataset status against the
 * `E3Provider`'s server and workspace, through the TanStack Query cache the
 * Datasets tab polls, a status read in the last 5 seconds serving again.
 *
 * @returns The status, or `undefined` when there is no server to ask
 */
export function useQuerySourceStatus(): QuerySourceStatus | undefined {
    const provided = useContext(QuerySourceStatusContext);
    const config = useE3ConfigOptional();
    const client = useContext(QueryClientContext);
    return useMemo((): QuerySourceStatus | undefined => {
        if (provided !== null) return provided;
        if (config === null || config.workspace === undefined) return undefined;
        const workspace = config.workspace;
        return async (path) => {
            const query = sourceStatusQuery(config, workspace, path);
            const detail = client === undefined ? await query.queryFn() : await client.fetchQuery({ ...query, staleTime: STATUS_FRESH_MS });
            return sourceStatusOf(detail);
        };
    }, [provided, config, client]);
}

// ============================================================================
// The plan's options (#941)
// ============================================================================

/** The builder's plan's options: the default, e3's smallest piece. */
const NO_PLAN_OPTIONS: PlanOptions = {};

const QueryPlanOptionsContext = createContext<PlanOptions>(NO_PLAN_OPTIONS);

/** Props of {@link QueryPlanOptionsProvider}. */
export interface QueryPlanOptionsProviderProps {
    /**
     * The most a dataset may weigh, in stored bytes, and still be read by one
     * call: e3's smallest piece (`PIECE_SIZES.min`, 16 MiB) when omitted. A
     * host over a server that cuts small pieces (`E3_TEST_PIECE_BYTES`) sets
     * it small, so its runs split.
     */
    pieceBytes?: number;
    /** The subtree. */
    children?: ReactNode;
}

/**
 * Sets how the query builder plans its runs for a subtree: the most a dataset
 * may weigh and still be read by one call.
 *
 * @param props - The options and the subtree
 * @returns The provider
 */
export function QueryPlanOptionsProvider({ pieceBytes, children }: QueryPlanOptionsProviderProps) {
    const value = useMemo((): PlanOptions => (pieceBytes === undefined ? NO_PLAN_OPTIONS : { pieceBytes }), [pieceBytes]);
    return createElement(QueryPlanOptionsContext.Provider, { value }, children);
}

/**
 * How the builder plans its runs: a {@link QueryPlanOptionsProvider}'s options,
 * else the defaults.
 *
 * @returns The options
 */
export function useQueryPlanOptions(): PlanOptions {
    return useContext(QueryPlanOptionsContext);
}

// ============================================================================
// Summaries
// ============================================================================

/**
 * The builder's summaries: #934's summary programs, each run as a one-shot
 * call with small limits when a slot that needs it opens, and kept by prefix
 * and the hashes of the datasets it read. A summary that fails leaves the
 * slot's offers without values.
 *
 * @param root - The root, or why it cannot be queried
 * @param call - How a one-shot call is made
 * @returns The cache, and the latest hash of each data source a run has read
 */
export function useQuerySummaries(root: QueryRoot | string, call: QueryCall | undefined): { cache: SummaryCache; hashes: ReadonlyMap<string, string> } {
    const [hashes, setHashes] = useState<ReadonlyMap<string, string>>(new Map());
    const cache = useMemo(() => new SummaryCache(async (request: SummaryRequest) => {
        if (typeof root === "string" || call === undefined) return undefined;
        const prepared = prepareQuery(request.program, root, SUMMARY_LIMITS);
        if ("result" in prepared) return undefined;
        const result = queryResultOf(prepared.prepared, await call(prepared.prepared.request));
        if (result.outcome.type !== "ok") return undefined;
        const decoded = decodeBeast2(result.outcome.value.result);
        if (!isValueOf(decoded.value, SummaryType)) return undefined;
        const read = new Map(result.inputs.map(input => [input.name, input.hash]));
        setHashes(previous => new Map([...previous, ...read]));
        return { summary: decoded.value as Summary, hashes: read };
    }), [root, call]);
    return { cache, hashes };
}

// ============================================================================
// Recent runs
// ============================================================================

/** How many recent runs a viewer keeps. */
export const RECENT_RUNS = 10;

/**
 * This viewer's recent runs, newest first, kept in the browser under the
 * builder's key — each a saved query's form, printed as East text. A query run
 * again moves to the front.
 *
 * @param key - The builder's recent-runs key (`queryKeys(id).recent`)
 * @returns The runs, and `remember(run)`
 */
export function useRecentQueries(key: string): { recent: readonly SavedQuery[]; remember: (run: SavedQuery) => void } {
    const { state, setState } = usePersistedState<string[]>(key, []);
    const recent = useMemo(() => state.flatMap((text) => {
        const read = parseSaved(text);
        return read.success ? [read.value] : [];
    }), [state]);
    const remember = useCallback((run: SavedQuery) => {
        const text = printSaved(run);
        setState(previous => [text, ...previous.filter((other) => {
            const read = parseSaved(other);
            // The same query, run before, gives way to this run.
            return read.success && !savedEqual({ ...read.value, saved_at: run.saved_at }, run);
        })].slice(0, RECENT_RUNS));
    }, [setState]);
    return { recent, remember };
}
