/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { taskGet } from '@elaraai/e3-api-client';
import type { RequestOptions, TaskDetails } from '@elaraai/e3-api-client';
import type { QueryOverrides } from './types.js';

export interface UseTaskDetailsOptions {
    requestOptions?: RequestOptions;
    queryOverrides?: QueryOverrides;
}

/** Fetch a task's details (name, kind, metadata, output, ...). */
export function useTaskDetails(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    taskName: string | null,
    options?: UseTaskDetailsOptions,
): UseQueryResult<TaskDetails, Error> {
    const reqOpts = options?.requestOptions ?? { token: null };
    return useQuery({
        queryKey: ['taskDetails', apiUrl, repo, workspace, taskName],
        queryFn: () => taskGet(apiUrl, repo, workspace!, taskName!, reqOpts),
        enabled: !!repo && !!workspace && !!taskName,
        ...options?.queryOverrides,
    });
}

/** Read `kind` from TaskDetails as a plain string ('ui' | 'data' | etc) or null. */
export function getTaskKind(details: TaskDetails): string | null {
    return details.kind?.type === 'some' ? details.kind.value : null;
}

/** Read `metadata` blob from TaskDetails or null. */
export function getTaskMetadata(details: TaskDetails): Uint8Array | null {
    return details.metadata?.type === 'some' ? details.metadata.value : null;
}
