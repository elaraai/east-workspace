/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete Cloud Resources — Removes schedules, task configs, user settings, and ACLs.
 * All operations are idempotent (safe to re-run on retry).
 */

import type { AclStore } from '../interfaces.js';
import type { ScheduleStore } from '../schedule-store.js';
import type { TaskConfigStore } from '../task-config-store.js';
import type { UserSettingsStore } from '../user-settings-store.js';
import type { SchedulerService } from '../scheduler-service.js';
import { deleteSchedulesForRepo } from './schedule-helpers.js';

export interface DeleteCloudResourcesInput {
  repo: string;
}

export interface DeleteCloudResourcesOutput {
  repo: string;
}

export interface DeleteCloudResourcesDeps {
  aclStore: AclStore;
  scheduleStore: ScheduleStore;
  taskConfigStore: TaskConfigStore;
  userSettingsStore: UserSettingsStore;
  schedulerService: SchedulerService | null;
}

export async function handleDeleteCloudResources(
  deps: DeleteCloudResourcesDeps,
  input: DeleteCloudResourcesInput,
): Promise<DeleteCloudResourcesOutput> {
  const { repo } = input;

  console.log(`Deleting cloud resources for ${repo}`);

  await deps.aclStore.deleteAllForRepo(repo);
  await deleteSchedulesForRepo(repo, deps.scheduleStore, deps.schedulerService);
  await deps.taskConfigStore.deleteAllForRepo(repo);
  await deps.userSettingsStore.deleteAllForRepo(repo);

  console.log(`Cloud resources deleted for ${repo}`);
  return { repo };
}
