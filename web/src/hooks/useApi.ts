/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  repoList,
  workspaceList,
  workspaceStatus,
  workspaceCreate,
  workspaceRemove,
  workspaceDeploy,
  packageList,
  packageImport,
  packageRemove,
  taskList,
  taskGet,
  dataflowGraph,
  dataflowStart,
  dataflowCancel,
  dataflowExecutePoll,
  datasetList,
  datasetSet,
} from '@elaraai/e3-api-client';
import type { WorkspaceInfo, PackageListItem } from '@elaraai/e3-api-client';
import { API_URL, getRequestOptions } from '../api';

// --- Queries ---

export function useRepoList() {
  return useQuery<string[]>({
    queryKey: ['repos'],
    queryFn: () => repoList(API_URL, getRequestOptions()),
  });
}

export function useWorkspaceList(repo: string) {
  return useQuery<WorkspaceInfo[]>({
    queryKey: ['workspaces', repo],
    queryFn: () => workspaceList(API_URL, repo, getRequestOptions()),
    enabled: !!repo,
  });
}

export function useWorkspaceStatus(repo: string, workspace: string) {
  return useQuery({
    queryKey: ['workspaceStatus', repo, workspace],
    queryFn: () => workspaceStatus(API_URL, repo, workspace, getRequestOptions()),
    enabled: !!repo && !!workspace,
    refetchInterval: 10_000,
  });
}

export function usePackageList(repo: string) {
  return useQuery<PackageListItem[]>({
    queryKey: ['packages', repo],
    queryFn: () => packageList(API_URL, repo, getRequestOptions()),
    enabled: !!repo,
  });
}

export function useTaskList(repo: string, workspace: string) {
  return useQuery({
    queryKey: ['tasks', repo, workspace],
    queryFn: () => taskList(API_URL, repo, workspace, getRequestOptions()),
    enabled: !!repo && !!workspace,
  });
}

export function useTaskDetails(repo: string, workspace: string, task: string) {
  return useQuery({
    queryKey: ['taskDetails', repo, workspace, task],
    queryFn: () => taskGet(API_URL, repo, workspace, task, getRequestOptions()),
    enabled: !!repo && !!workspace && !!task,
  });
}

export function useDataflowGraph(repo: string, workspace: string) {
  return useQuery({
    queryKey: ['dataflowGraph', repo, workspace],
    queryFn: () => dataflowGraph(API_URL, repo, workspace, getRequestOptions()),
    enabled: !!repo && !!workspace,
  });
}

export function useDataflowExecution(repo: string, workspace: string) {
  return useQuery({
    queryKey: ['dataflowExecution', repo, workspace],
    queryFn: () => dataflowExecutePoll(API_URL, repo, workspace, undefined, getRequestOptions()),
    enabled: !!repo && !!workspace,
  });
}

export function useDatasetList(repo: string, workspace: string) {
  return useQuery({
    queryKey: ['datasets', repo, workspace],
    queryFn: () => datasetList(API_URL, repo, workspace, getRequestOptions()),
    enabled: !!repo && !!workspace,
  });
}

// --- Mutations ---

export function useWorkspaceCreate(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => workspaceCreate(API_URL, repo, name, getRequestOptions()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspaces', repo] }); },
  });
}

export function useWorkspaceRemove(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => workspaceRemove(API_URL, repo, name, getRequestOptions()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspaces', repo] }); },
  });
}

export function useWorkspaceDeploy(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, packageRef }: { name: string; packageRef: string }) =>
      workspaceDeploy(API_URL, repo, name, packageRef, getRequestOptions()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspaces', repo] }); },
  });
}

export function useDataflowStartMutation(repo: string, workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { concurrency?: number; force?: boolean; filter?: string }) =>
      dataflowStart(API_URL, repo, workspace, opts, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaceStatus', repo, workspace] });
    },
  });
}

export function useDataflowCancelMutation(repo: string, workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => dataflowCancel(API_URL, repo, workspace, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaceStatus', repo, workspace] });
    },
  });
}

export function usePackageImport(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (archive: Uint8Array) => packageImport(API_URL, repo, archive, getRequestOptions()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packages', repo] }); },
  });
}

export function usePackageRemove(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, version }: { name: string; version: string }) =>
      packageRemove(API_URL, repo, name, version, getRequestOptions()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packages', repo] }); },
  });
}

export function useDatasetSet(repo: string, workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, data }: { path: Array<{ type: 'field'; value: string }>; data: Uint8Array }) =>
      datasetSet(API_URL, repo, workspace, path as Parameters<typeof datasetSet>[3], data, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaceStatus', repo, workspace] });
      qc.invalidateQueries({ queryKey: ['datasets', repo, workspace] });
    },
  });
}
