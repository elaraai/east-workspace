/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useQuery, useMutation, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { QueryOverrides } from './types.js';
import {
    workspaceList, workspaceCreate, workspaceCopy, workspaceGet, workspaceStatus, workspaceRemove, workspaceDeploy, workspaceExport,
} from '@elaraai/e3-api-client';
import type { RequestOptions, WorkspaceDeployOptions, WorkspaceDeployResult, WorkspaceInfo, WorkspaceStatusResult } from '@elaraai/e3-api-client';
import type { WorkspaceState } from '@elaraai/e3-types';

export function useWorkspaceList(url: string, repo: string, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<WorkspaceInfo[], Error> {
    return useQuery({
        queryKey: ['workspaceList', url, repo],
        queryFn: () => workspaceList(url, repo, requestOptions ?? { token: null }),
        enabled: !!repo,
        ...queryOptions,
    });
}

export function useWorkspaceCreate(url: string, repo: string, requestOptions?: RequestOptions): UseMutationResult<WorkspaceInfo, Error, string> {
    return useMutation<WorkspaceInfo, Error, string>({
        mutationFn: (name) => workspaceCreate(url, repo, name, requestOptions ?? { token: null }),
    });
}

/**
 * Copy a workspace within its repository: the target becomes the source as it
 * is now, made or replaced whole, its refs only written.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param requestOptions - Request options including auth token
 * @returns A mutation, given the workspace copied and the one it is copied to,
 *   whose data is the target as the workspace list gives it
 */
export function useWorkspaceCopy(
    url: string,
    repo: string,
    requestOptions?: RequestOptions,
): UseMutationResult<WorkspaceInfo, Error, { from: string; to: string }> {
    return useMutation<WorkspaceInfo, Error, { from: string; to: string }>({
        mutationFn: ({ from, to }) => workspaceCopy(url, repo, from, to, requestOptions ?? { token: null }),
    });
}

export function useWorkspaceGet(url: string, repo: string, name: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<WorkspaceState, Error> {
    return useQuery({
        queryKey: ['workspaceGet', url, repo, name],
        queryFn: () => workspaceGet(url, repo, name!, requestOptions ?? { token: null }),
        enabled: !!repo && !!name,
        ...queryOptions,
    });
}

export function useWorkspaceStatus(url: string, repo: string, name: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides): UseQueryResult<WorkspaceStatusResult, Error> {
    return useQuery({
        queryKey: ['workspaceStatus', url, repo, name],
        queryFn: () => workspaceStatus(url, repo, name!, requestOptions ?? { token: null }),
        enabled: !!repo && !!name,
        ...queryOptions,
    });
}

export function useWorkspaceRemove(url: string, repo: string, requestOptions?: RequestOptions) {
    return useMutation<void, Error, string>({
        mutationFn: (name) => workspaceRemove(url, repo, name, requestOptions ?? { token: null }),
    });
}

/**
 * Deploy a package to a workspace.
 *
 * @remarks
 * The server runs the deploy as a job, which the mutation polls, so it
 * settles once the deploy has finished.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param requestOptions - Request options including auth token
 * @returns A mutation, given the workspace, the package reference and the
 *   deploy's options — what it does with a record it cannot keep and with an
 *   input someone set, and whether it only plans — whose data is what the
 *   deploy decided for each record, index and input
 */
export function useWorkspaceDeploy(
    url: string,
    repo: string,
    requestOptions?: RequestOptions,
): UseMutationResult<WorkspaceDeployResult, Error, { name: string; packageRef: string; options?: WorkspaceDeployOptions }> {
    return useMutation<WorkspaceDeployResult, Error, { name: string; packageRef: string; options?: WorkspaceDeployOptions }>({
        mutationFn: ({ name, packageRef, options }) => workspaceDeploy(url, repo, name, packageRef, requestOptions ?? { token: null }, options),
    });
}

export function useWorkspaceExport(url: string, repo: string, name: string | null, requestOptions?: RequestOptions, queryOptions?: QueryOverrides) {
    return useQuery({
        queryKey: ['workspaceExport', url, repo, name],
        queryFn: () => workspaceExport(url, repo, name!, requestOptions ?? { token: null }),
        enabled: !!repo && !!name,
        ...queryOptions,
    });
}
