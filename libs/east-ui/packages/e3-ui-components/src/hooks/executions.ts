/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useQuery, useMutation, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { IntegerType, printFor } from '@elaraai/east';
import type { QueryOverrides } from './types.js';
import { dataflowExecute, dataflowExecuteLaunch, dataflowGraph, dataflowExecutePoll, dataflowCancel, taskLogs } from '@elaraai/e3-api-client';
import type { RequestOptions, DataflowOptions, DataflowPollOptions, ExecutionStateOptions, LogOptions, DataflowResult, DataflowExecutionState } from '@elaraai/e3-api-client';

/** Prints a poll's cursor for its query key, which react-query hashes as
 *  JSON, where a bigint does not go. */
const printSeq = printFor(IntegerType);

export function useDataflowExecute(url: string, repo: string, workspace: string | null, requestOptions?: RequestOptions): UseMutationResult<DataflowResult, Error, { dataflowOptions?: DataflowOptions; pollOptions?: DataflowPollOptions }> {
    return useMutation<DataflowResult, Error, { dataflowOptions?: DataflowOptions; pollOptions?: DataflowPollOptions }>({
        mutationFn: ({ dataflowOptions, pollOptions } = {}) =>
            dataflowExecute(url, repo, workspace!, dataflowOptions, requestOptions ?? { token: null }, pollOptions),
    });
}

export function useDataflowStart(url: string, repo: string, workspace: string | null, requestOptions?: RequestOptions) {
    return useMutation<void, Error, DataflowOptions | undefined>({
        mutationFn: (dataflowOptions) =>
            dataflowExecuteLaunch(url, repo, workspace!, dataflowOptions, requestOptions ?? { token: null }),
    });
}

export function useDataflowGraph(url: string, repo: string, workspace: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides) {
    return useQuery({
        queryKey: ['dataflowGraph', url, repo, workspace],
        queryFn: () => dataflowGraph(url, repo, workspace!, requestOptions ?? { token: null }),
        enabled: !!repo && !!workspace,
        ...queryOptions,
    });
}

/**
 * Polls a workspace's latest run: its state, with the events past
 * `stateOptions.since`, at most `stateOptions.limit` of them, and the cursor
 * past them (`nextSeq`).
 *
 * @param url - The API's base URL
 * @param repo - Repository name
 * @param workspace - Workspace name; nothing is polled while it is `null`
 * @param stateOptions - The cursor to poll from, and the most events to serve:
 *   `{ limit: 0 }` reads the run's state alone
 * @param requestOptions - The request's token
 * @param queryOptions - react-query overrides, such as a `refetchInterval`
 * @returns The query of the run's state
 */
export function useDataflowExecution(url: string, repo: string, workspace: string | null, stateOptions?: ExecutionStateOptions, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<DataflowExecutionState, Error> {
    const since = stateOptions?.since === undefined ? null : printSeq(stateOptions.since);
    return useQuery({
        queryKey: ['dataflowExecution', url, repo, workspace, since, stateOptions?.limit ?? null],
        queryFn: () => dataflowExecutePoll(url, repo, workspace!, stateOptions, requestOptions ?? { token: null }),
        enabled: !!repo && !!workspace,
        ...queryOptions,
    });
}

export function useDataflowCancel(url: string, repo: string, workspace: string | null, requestOptions?: RequestOptions) {
    return useMutation<void, Error, void>({
        mutationFn: () => dataflowCancel(url, repo, workspace!, requestOptions ?? { token: null }),
    });
}

export function useTaskLogs(url: string, repo: string, workspace: string | null, task: string | null, logOptions?: LogOptions, requestOptions?: RequestOptions, queryOptions?: QueryOverrides) {
    return useQuery({
        queryKey: ['taskLogs', url, repo, workspace, task, logOptions],
        queryFn: () => taskLogs(url, repo, workspace!, task!, logOptions, requestOptions ?? { token: null }),
        enabled: !!repo && !!workspace && !!task,
        ...queryOptions,
    });
}
