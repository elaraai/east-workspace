/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

import type { Schedule } from '@elaraai/e3-cloud-types';

/**
 * Storage interface for workspace schedules.
 *
 * Implementations:
 * - DynamoScheduleStore (e3-aws-storage) - DynamoDB-backed
 */
export interface ScheduleStore {
  /** Get the schedule for a workspace (null if none) */
  get(repo: string, workspace: string): Promise<Schedule | null>;

  /** Create or update a schedule */
  put(repo: string, workspace: string, schedule: Schedule): Promise<void>;

  /** Delete a schedule */
  delete(repo: string, workspace: string): Promise<void>;

  /** List all schedules for a repository */
  listForRepo(repo: string): Promise<Schedule[]>;

  /** Delete all schedules for a repository (used during repo deletion) */
  deleteAllForRepo(repo: string): Promise<void>;
}
