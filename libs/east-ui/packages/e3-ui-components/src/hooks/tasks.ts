/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { QueryOverrides } from './types.js';
import { taskList, taskGet, taskExecutionList } from '@elaraai/e3-api-client';
import type { RequestOptions, TaskDetails, TaskListItem, ExecutionListItem } from '@elaraai/e3-api-client';

// NOTE: the return type must stay explicitly annotated. TaskListItem carries
// an East option (`kind`), so the inferred type references east-internal
// symbols the declaration emitter cannot name (TS4058) — vite-plugin-dts then
// silently drops this whole FILE from the published types (how 1.0.38 shipped
// without the task hooks).
export function useTaskList(url: string, repo: string, workspace: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<TaskListItem[], Error> {
    return useQuery({
        queryKey: ['taskList', url, repo, workspace],
        queryFn: () => taskList(url, repo, workspace!, requestOptions ?? { token: null }),
        enabled: !!repo && !!workspace,
        ...queryOptions,
    });
}

export function useTaskGet(url: string, repo: string, workspace: string | null, name: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<TaskDetails, Error> {
    return useQuery({
        queryKey: ['taskGet', url, repo, workspace, name],
        queryFn: () => taskGet(url, repo, workspace!, name!, requestOptions ?? { token: null }),
        enabled: !!repo && !!workspace && !!name,
        ...queryOptions,
    });
}

export function useTaskExecutionList(url: string, repo: string, workspace: string | null, taskName: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<ExecutionListItem[], Error> {
    return useQuery({
        queryKey: ['taskExecutionList', url, repo, workspace, taskName],
        queryFn: () => taskExecutionList(url, repo, workspace!, taskName!, requestOptions ?? { token: null }),
        enabled: !!repo && !!workspace && !!taskName,
        ...queryOptions,
    });
}
