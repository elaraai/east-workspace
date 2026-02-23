/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useQuery, useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { ArrayType, StringType, variant } from '@elaraai/east';
import { get } from '@elaraai/e3-api-client';
import {
  whoami,
  repoUsers,
  addUser,
  removeUser,
  listSchedules,
  setSchedule,
  removeSchedule,
} from '@elaraai/e3-cloud-client';
import { RepoUserType } from '@elaraai/e3-cloud-types';
import type { RepoUser, WhoamiResponse, Schedule, ScheduleRequest, AddUserRequest } from '@elaraai/e3-cloud-client';
import type { WorkspaceInfo, DataflowExecutionState } from '@elaraai/e3-api-client';
import { workspaceList, dataflowExecutePoll } from '@elaraai/e3-api-client';
import { API_URL, getRequestOptions } from '../api';

// --- Auth ---

export function useWhoami() {
  return useQuery<WhoamiResponse>({
    queryKey: ['whoami'],
    queryFn: () => whoami(API_URL, getRequestOptions()),
    staleTime: 5 * 60_000,
  });
}

// --- Admin Repos (bypasses ACL) ---

export function useAdminRepos() {
  return useQuery<string[]>({
    queryKey: ['admin', 'repos'],
    queryFn: () => get(API_URL, `/admin/repos`, ArrayType(StringType), getRequestOptions()),
  });
}

export function useAdminRepoUsers(repo: string) {
  return useQuery<RepoUser[]>({
    queryKey: ['admin', 'repos', repo, 'users'],
    queryFn: () => get(API_URL, `/admin/repos/${encodeURIComponent(repo)}/users`, ArrayType(RepoUserType), getRequestOptions()),
    enabled: !!repo,
  });
}

// --- Per-repo data ---

export function useRepoUsers(repo: string) {
  return useQuery<RepoUser[]>({
    queryKey: ['repos', repo, 'users'],
    queryFn: () => repoUsers(API_URL, repo, getRequestOptions()),
    enabled: !!repo,
  });
}

export function useRepoSchedules(repo: string) {
  return useQuery<Schedule[]>({
    queryKey: ['repos', repo, 'schedules'],
    queryFn: () => listSchedules(API_URL, repo, getRequestOptions()),
    enabled: !!repo,
    refetchInterval: 1_000,
  });
}

// --- Mutations ---

export function useAddRepoUser(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: AddUserRequest) => addUser(API_URL, repo, request, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'repos', repo, 'users'] });
      qc.invalidateQueries({ queryKey: ['repos', repo, 'users'] });
    },
  });
}

export function useRemoveRepoUser(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeUser(API_URL, repo, userId, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'repos', repo, 'users'] });
      qc.invalidateQueries({ queryKey: ['repos', repo, 'users'] });
    },
  });
}

export function useToggleSchedule(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (schedule: Schedule) => {
      const request: ScheduleRequest = {
        cronExpression: schedule.cronExpression,
        timezone: variant('some', schedule.timezone) as ScheduleRequest['timezone'],
        forceTasks: schedule.forceTasks,
        enabled: !schedule.enabled,
        description: schedule.description,
      };
      return setSchedule(API_URL, repo, schedule.workspace, request, getRequestOptions());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repos', repo, 'schedules'] });
    },
  });
}

export function useRemoveSchedule(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspace: string) => removeSchedule(API_URL, repo, workspace, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repos', repo, 'schedules'] });
    },
  });
}

export function useSetSchedule(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspace, request }: { workspace: string; request: ScheduleRequest }) =>
      setSchedule(API_URL, repo, workspace, request, getRequestOptions()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repos', repo, 'schedules'] });
    },
  });
}

export function useWorkspaceExecution(repo: string, workspace: string) {
  return useQuery<DataflowExecutionState | null>({
    queryKey: ['execution', repo, workspace],
    queryFn: async () => {
      try {
        return await dataflowExecutePoll(API_URL, repo, workspace, undefined, getRequestOptions());
      } catch {
        return null;
      }
    },
    enabled: !!repo && !!workspace,
    refetchInterval: 1_000,
  });
}

// --- Aggregation: per-repo summaries ---

export interface RepoSummary {
  repo: string;
  workspaceCount: number;
  scheduleCount: number;
  activeScheduleCount: number;
  userCount: number;
}

export function useAdminRepoSummaries(repos: string[]) {
  const workspaceQueries = useQueries({
    queries: repos.map((repo) => ({
      queryKey: ['workspaces', repo],
      queryFn: () => workspaceList(API_URL, repo, getRequestOptions()),
      enabled: !!repo,
    })),
  });

  const scheduleQueries = useQueries({
    queries: repos.map((repo) => ({
      queryKey: ['repos', repo, 'schedules'],
      queryFn: () => listSchedules(API_URL, repo, getRequestOptions()),
      enabled: !!repo,
    })),
  });

  const userQueries = useQueries({
    queries: repos.map((repo) => ({
      queryKey: ['admin', 'repos', repo, 'users'],
      queryFn: () => get(API_URL, `/admin/repos/${encodeURIComponent(repo)}/users`, ArrayType(RepoUserType), getRequestOptions()),
      enabled: !!repo,
    })),
  });

  const isLoading = workspaceQueries.some((q) => q.isLoading) ||
    scheduleQueries.some((q) => q.isLoading) ||
    userQueries.some((q) => q.isLoading);

  const summaries: RepoSummary[] = repos.map((repo, i) => {
    const workspaces = (workspaceQueries[i]?.data as WorkspaceInfo[] | undefined) ?? [];
    const schedules = (scheduleQueries[i]?.data as Schedule[] | undefined) ?? [];
    const users = (userQueries[i]?.data as RepoUser[] | undefined) ?? [];
    return {
      repo,
      workspaceCount: workspaces.length,
      scheduleCount: schedules.length,
      activeScheduleCount: schedules.filter((s) => s.enabled).length,
      userCount: users.length,
    };
  });

  return { summaries, isLoading };
}
