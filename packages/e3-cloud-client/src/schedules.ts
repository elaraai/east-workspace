/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Schedule management API functions using BEAST2 format.
 */

import { ArrayType, NullType } from '@elaraai/east';
import {
  ScheduleType,
  ScheduleRequestType,
  type Schedule,
  type ScheduleRequest,
} from '@elaraai/e3-cloud-types';
import { get, put, del, ApiError, type RequestOptions } from '@elaraai/e3-api-client';

/**
 * Get the schedule for a workspace.
 *
 * @returns The schedule, or null if none exists
 */
export async function getSchedule(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<Schedule | null> {
  try {
    return await get(
      url,
      `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/schedule`,
      ScheduleType,
      options
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_found') {
      return null;
    }
    throw err;
  }
}

/**
 * Create or update a schedule for a workspace.
 */
export async function setSchedule(
  url: string,
  repo: string,
  workspace: string,
  request: ScheduleRequest,
  options: RequestOptions
): Promise<Schedule> {
  return put(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/schedule`,
    request,
    ScheduleRequestType,
    ScheduleType,
    options
  );
}

/**
 * Delete a schedule for a workspace.
 */
export async function removeSchedule(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<void> {
  await del(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/schedule`,
    NullType,
    options
  );
}

/**
 * List all schedules for a repository.
 */
export async function listSchedules(
  url: string,
  repo: string,
  options: RequestOptions
): Promise<Schedule[]> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/schedules`,
    ArrayType(ScheduleType),
    options
  );
}
