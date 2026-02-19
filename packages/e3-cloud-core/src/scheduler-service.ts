/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Cloud-agnostic interface for managing scheduled executions.
 *
 * The AWS implementation wraps EventBridge Scheduler DeleteScheduleCommand.
 */
export interface SchedulerService {
  /** Delete a single schedule by scheduler name */
  deleteSchedule(schedulerName: string): Promise<void>;
}
