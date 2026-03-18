/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Schedule cleanup helpers — extracted to avoid dependency on routes module.
 */

import type { ScheduleStore } from '../schedule-store.js';
import type { SchedulerService } from '../scheduler-service.js';

/**
 * Delete a single workspace's EventBridge Scheduler schedule.
 */
export async function deleteScheduleForWorkspace(
  repo: string,
  workspace: string,
  scheduleStore: ScheduleStore,
  schedulerService: SchedulerService | null,
): Promise<void> {
  const schedule = await scheduleStore.get(repo, workspace);
  if (schedule) {
    if (schedulerService) {
      try {
        await schedulerService.deleteSchedule(schedule.schedulerName);
      } catch (err) {
        console.error(`Failed to delete EventBridge schedule ${schedule.schedulerName}:`, err);
      }
    }
    await scheduleStore.delete(repo, workspace);
  }
}

/**
 * Delete all schedules for a repository.
 */
export async function deleteSchedulesForRepo(
  repo: string,
  scheduleStore: ScheduleStore,
  schedulerService: SchedulerService | null,
): Promise<void> {
  const schedules = await scheduleStore.listForRepo(repo);
  for (const schedule of schedules) {
    if (schedulerService) {
      try {
        await schedulerService.deleteSchedule(schedule.schedulerName);
      } catch (err) {
        console.error(`Failed to delete EventBridge schedule ${schedule.schedulerName}:`, err);
      }
    }
  }
  await scheduleStore.deleteAllForRepo(repo);
}
