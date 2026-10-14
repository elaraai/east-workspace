/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { taskGet } from '@elaraai/e3-api-client';
import type { RequestOptions, TaskDetails } from '@elaraai/e3-api-client';
import type { QueryOverrides } from './types.js';
import { taskDetailsQueryKey } from './tasks.js';

export interface UseTaskDetailsOptions {
    requestOptions?: RequestOptions;
    queryOverrides?: QueryOverrides;
    /**
     * The task's details, when the caller holds them — from a task list it
     * read, or a preview that read them: the query is answered from them,
     * first and as they change, and the server is not asked.
     */
    details?: TaskDetails;
}

/**
 * Fetch a task's details (name, body, runner, inputs, output, role).
 *
 * @remarks
 * The query is keyed as `useTaskGet`'s ({@link taskDetailsQueryKey}), so a
 * preview and the host that opened it share one read; and a caller that
 * holds the details gives them (`options.details`), which answers the query
 * without a request — and answers it again as they change, so a host that
 * read the task again hands the preview what it read.
 *
 * @param apiUrl - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name; nothing is read while `null`
 * @param taskName - The task; nothing is read while `null`
 * @param options - The requests' options, react-query overrides, and the
 *   details when held
 * @returns The query of the details
 */
export function useTaskDetails(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    taskName: string | null,
    options?: UseTaskDetailsOptions,
): UseQueryResult<TaskDetails, Error> {
    const reqOpts = options?.requestOptions ?? { token: null };
    const details = options?.details;
    const client = useQueryClient();
    const queryKey = useMemo(() => taskDetailsQueryKey(apiUrl, repo, workspace, taskName), [apiUrl, repo, workspace, taskName]);
    // The details the host holds answer the query as they change: the first
    // are its initial data, and each after replaces what the query holds.
    useEffect(() => {
        if (details !== undefined) client.setQueryData(queryKey, details);
    }, [client, details, queryKey]);
    return useQuery({
        queryKey,
        queryFn: () => taskGet(apiUrl, repo, workspace!, taskName!, reqOpts),
        enabled: !!repo && !!workspace && !!taskName && details === undefined,
        ...(details !== undefined && { initialData: details }),
        ...options?.queryOverrides,
    });
}
