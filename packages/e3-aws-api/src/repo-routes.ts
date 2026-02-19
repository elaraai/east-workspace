/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Repository Lifecycle Routes for e3 Cloud Platform
 *
 * Provides repository management endpoints:
 * - GET /api/repos — List repositories
 * - PUT /api/repos/:repo — Create repository
 * - DELETE /api/repos/:repo — Delete repository
 */

import { Hono } from 'hono';
import { StringType, NullType, ArrayType, variant, some, none } from '@elaraai/east';
import { sendSuccess, sendError, sendSuccessWithStatus } from '@elaraai/e3-api-server/beast2';
import { extractIdentity } from './auth/index.js';
import { RepoAlreadyExistsError, InvalidRepoStatusError } from '@elaraai/e3-cloud-core';
import type { AclStore, RepoManager, ScheduleStore, TaskConfigStore, SchedulerService } from '@elaraai/e3-cloud-core';
import type { RepoStore } from '@elaraai/e3-core';

/** Helper to extract identity from Hono context (API Gateway event). */
function getIdentity(c: any) {
  const env = c.env as { event: unknown };
  return extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);
}

/** Helper to create internal API errors */
const internalError = (message: string) => variant('internal', { message });

/**
 * Delete all EventBridge Scheduler schedules for a repo.
 * Reads schedule records from DynamoDB to get scheduler names, then deletes them.
 */
export async function deleteSchedulesForRepo(
  repo: string,
  scheduleStore: ScheduleStore,
  schedulerService: SchedulerService | null,
): Promise<void> {
  if (schedulerService) {
    const schedules = await scheduleStore.listForRepo(repo);
    for (const schedule of schedules) {
      try {
        await schedulerService.deleteSchedule(schedule.schedulerName);
      } catch (err) {
        console.error(`Failed to delete EventBridge schedule ${schedule.schedulerName}:`, err);
      }
    }
  }
  await scheduleStore.deleteAllForRepo(repo);
}

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
 * Create repository lifecycle routes.
 */
export function createRepoRoutes(deps: {
  repoManager: RepoManager;
  aclStore: AclStore;
  scheduleStore: ScheduleStore;
  taskConfigStore: TaskConfigStore;
  schedulerService: SchedulerService | null;
  repoStore: RepoStore;
}): Hono {
  const { repoManager, aclStore, scheduleStore, taskConfigStore, schedulerService, repoStore } = deps;
  const app = new Hono();

  // GET /api/repos - List repositories accessible to the user
  app.get('/api/repos', async (c) => {
    const identity = getIdentity(c);

    try {
      if (!identity) {
        return sendSuccess(ArrayType(StringType), []);
      }

      if (identity.isAdmin) {
        const repos = await repoManager.listRepos();
        return sendSuccess(ArrayType(StringType), repos);
      }

      const repos = await aclStore.listReposForUser(identity.sub);
      return sendSuccess(ArrayType(StringType), repos);
    } catch (err) {
      console.error('Failed to list repos:', err);
      return sendError(ArrayType(StringType), internalError('Failed to list repositories'));
    }
  });

  // PUT /api/repos/:repo - Create a repository
  app.put('/api/repos/:repo', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!/^[a-zA-Z0-9_-]+$/.test(repo)) {
      return sendError(StringType, internalError('Invalid repository name. Use only letters, numbers, hyphens, and underscores.'));
    }

    try {
      const existing = await repoManager.getRepoMetadata(repo);
      if (existing) {
        switch (existing.status) {
          case 'active':
            return sendError(StringType, internalError(`Repository '${repo}' already exists`));
          case 'creating':
            return sendError(StringType, internalError(`Repository '${repo}' is being created. Please wait.`));
          case 'deleting':
            return sendError(StringType, internalError(`Repository '${repo}' is being deleted. Please wait and try again.`));
          case 'gc':
            return sendError(StringType, internalError(`Repository '${repo}' already exists (currently running GC)`));
        }
      }

      await repoManager.createRepo(repo);

      if (identity) {
        await aclStore.addUser(repo, {
          userId: identity.sub,
          email: identity.email ?? 'unknown',
          name: identity.name ? some(identity.name) : none,
          role: variant('owner', null),
          addedBy: identity.sub,
          addedAt: new Date().toISOString(),
        });
        console.log(`Added ${identity.email ?? identity.sub} as owner of repo '${repo}'`);
      }

      return sendSuccessWithStatus(StringType, repo, 201);
    } catch (err) {
      if (err instanceof RepoAlreadyExistsError) {
        return sendError(StringType, internalError(`Repository '${repo}' already exists`));
      }
      console.error('Failed to create repo:', err);
      return sendError(StringType, internalError('Failed to create repository'));
    }
  });

  // DELETE /api/repos/:repo - Delete a repository (synchronous)
  app.delete('/api/repos/:repo', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    try {
      const metadata = await repoManager.getRepoMetadata(repo);
      if (!metadata) {
        return sendError(NullType, variant('repository_not_found', { repo }));
      }

      if (metadata.status === 'deleting') {
        return sendSuccess(NullType, null);
      }

      if (metadata.status === 'gc') {
        return sendError(NullType, internalError(`Repository '${repo}' is currently running GC. Please wait for GC to complete.`));
      }
      if (metadata.status === 'creating') {
        return sendError(NullType, internalError(`Repository '${repo}' is still being created. Please wait.`));
      }

      // 1. Mark as 'deleting'
      await repoManager.setRepoStatus(repo, 'active', 'deleting');

      // 2. Delete ACL entries
      await aclStore.deleteAllForRepo(repo);

      // 2b. Delete schedules (DynamoDB + EventBridge Scheduler)
      await deleteSchedulesForRepo(repo, scheduleStore, schedulerService);

      // 2c. Delete task configs
      await taskConfigStore.deleteAllForRepo(repo);

      // 3. Delete refs synchronously
      let cursor: string | undefined;
      do {
        const result = await repoStore.deleteRefsBatch(repo, cursor);
        cursor = result.status === 'continue' ? result.cursor : undefined;
      } while (cursor);

      // 4. Objects cleaned up by GC later

      // 5. Remove repo metadata
      await repoStore.remove(repo);

      console.log(`Repository '${repo}' deleted successfully, deletedBy=${identity?.sub ?? 'unknown'}, deletedByEmail=${identity?.email ?? 'unknown'}`);
      return sendSuccess(NullType, null);
    } catch (err) {
      if (err instanceof InvalidRepoStatusError) {
        return sendError(NullType, internalError(err.message));
      }
      console.error('Failed to delete repo:', err);
      return sendError(NullType, internalError('Failed to delete repository'));
    }
  });

  return app;
}
