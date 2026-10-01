/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's hooks (#935) — what its surfaces use to resolve the
 * root, check, run and summarise a query, and to keep this viewer's recent
 * runs.
 *
 * - **The root** (`useQueryRoot`): each bound data source as a root field —
 *   its name, its dataset's path and its value's type — in the order given.
 * - **The call** (`useQueryCall`): how a one-shot call is made — e3-api-client's
 *   `oneShotExecute` against the `E3Provider`'s server, or a host's own
 *   ({@link QueryCallProvider}).
 * - **A run** (`useQueryRun`): the query prepared in the browser and sent as
 *   one one-shot call; one run in flight, a new run abandoning the old.
 * - **Summaries** (`useQuerySummaries`): #934's summary programs, run the same
 *   way, kept by prefix and the hashes of what they read.
 * - **Recent runs** (`useRecentQueries`): this viewer's last ten, kept in the
 *   browser under the builder's key.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
    ArrayType, SummaryType, decodeBeast2, equalFor, isValueOf, parseFor, printFor, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { DataSourceType, SavedQueryType } from "@elaraai/e3-ui/internal";
import { oneShotExecute } from "@elaraai/e3-api-client";
import type { ExecuteResult, OneShotRequest, TreePath } from "@elaraai/e3-types";
import { useDataStable, usePersistedState } from "@elaraai/east-ui-components";
import { useE3ConfigOptional } from "../platform/e3-config.js";
import { pagedSourceOf } from "../platform/paged-runtime.js";
import { SUMMARY_LIMITS, SummaryCache, type Summary, type SummaryRequest } from "./model/summaries.js";
import type { QueryWords } from "./model/words.js";
import { prepareQuery, queryResultOf, queryRoot, type QueryResult, type QueryRoot, type QueryRootEntry } from "./one-shot.js";

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
 * workspace.
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
        return (request) => oneShotExecute(apiUrl, repo, workspace, request, { token: config.token ?? null });
    }, [provided, config]);
}

// ============================================================================
// A run
// ============================================================================

/** Where a builder's run stands. */
export type QueryRunState =
    | { readonly status: "idle" }
    | { readonly status: "running"; readonly program: string }
    | { readonly status: "done"; readonly program: string; readonly result: QueryResult; readonly at: Date; readonly ms: number }
    | { readonly status: "failed"; readonly program: string; readonly message: string };

/**
 * Runs queries: each prepared in the browser and sent as one one-shot call.
 * One run is in flight at a time; a new run abandons the one before, whose
 * answer is dropped.
 *
 * @param root - The root, or why it cannot be queried
 * @param call - How a one-shot call is made
 * @param onRan - Told each answer, as the run's saved form, for the recent runs
 * @returns The run's state, and `run(program)`
 */
export function useQueryRun(
    root: QueryRoot | string, call: QueryCall | undefined, onRan?: (result: QueryResult) => void,
): { state: QueryRunState; run: (program: string) => void } {
    const [state, setState] = useState<QueryRunState>({ status: "idle" });
    const seq = useRef(0);
    const run = useCallback((program: string) => {
        const mine = ++seq.current;
        if (typeof root === "string") {
            setState({ status: "failed", program, message: root });
            return;
        }
        const prepared = prepareQuery(program, root);
        if ("result" in prepared) {
            setState({ status: "done", program, result: prepared.result, at: new Date(), ms: 0 });
            return;
        }
        if (call === undefined) {
            setState({ status: "failed", program, message: "no server" });
            return;
        }
        setState({ status: "running", program });
        const started = performance.now();
        call(prepared.prepared.request).then(
            (answer) => {
                if (seq.current !== mine) return;
                const result = queryResultOf(prepared.prepared, answer);
                setState({ status: "done", program, result, at: new Date(), ms: performance.now() - started });
                if (onRan !== undefined) queueMicrotask(() => onRan(result));
            },
            (err: unknown) => {
                if (seq.current !== mine) return;
                setState({ status: "failed", program, message: err instanceof Error ? err.message : String(err) });
            },
        );
    }, [root, call, onRan]);
    return { state, run };
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
