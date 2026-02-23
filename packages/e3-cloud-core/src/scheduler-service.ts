/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Cloud-agnostic interface for managing scheduled executions.
 *
 * The AWS implementation wraps EventBridge Scheduler commands.
 */
export interface SchedulerService {
  /** Create or update a schedule */
  upsertSchedule(params: {
    name: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    description: string;
    targetInput: string;
  }): Promise<void>;

  /** Delete a single schedule by scheduler name */
  deleteSchedule(schedulerName: string): Promise<void>;
}
