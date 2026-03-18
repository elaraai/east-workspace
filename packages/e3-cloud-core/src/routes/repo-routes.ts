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
import { RepoAlreadyExistsError, InvalidRepoStatusError } from '../errors.js';
import type { AclStore, IdentityBackend } from '../interfaces.js';
import type { RepoManager } from '../repo-manager.js';
import type { ScheduleStore } from '../schedule-store.js';
import type { TaskConfigStore } from '../task-config-store.js';
import type { UserSettingsStore } from '../user-settings-store.js';
import type { SchedulerService } from '../scheduler-service.js';
import type { DeleteOrchestrator } from '../delete-orchestrator.js';
import type { RepoStore } from '@elaraai/e3-core';

/** Helper to extract identity from Hono context via IdentityBackend. */
function getIdentity(c: any, identityBackend: IdentityBackend) {
  const env = c.env as { event: unknown };
  return identityBackend.getIdentity(env.event);
}

/** Helper to create internal API errors */
const internalError = (message: string) => variant('internal', { message });

import { deleteSchedulesForRepo, deleteScheduleForWorkspace } from '../deletion/schedule-helpers.js';
// Re-export for backward compatibility
export { deleteSchedulesForRepo, deleteScheduleForWorkspace };

/**
 * Create repository lifecycle routes.
 */
export function createRepoRoutes(deps: {
  repoManager: RepoManager;
  aclStore: AclStore;
  scheduleStore: ScheduleStore;
  taskConfigStore: TaskConfigStore;
  userSettingsStore: UserSettingsStore;
  schedulerService: SchedulerService | null;
  repoStore: RepoStore;
  listWorkspaces: (repo: string) => Promise<string[]>;
  deleteOrchestrator: DeleteOrchestrator | null;
  identityBackend: IdentityBackend;
}): Hono {
  const { repoManager, aclStore, scheduleStore, taskConfigStore, userSettingsStore, schedulerService, repoStore, listWorkspaces, deleteOrchestrator, identityBackend } = deps;
  const app = new Hono();

  // GET /api/repos - List repositories accessible to the user
  app.get('/api/repos', async (c) => {
    const identity = getIdentity(c, identityBackend);

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
    const identity = getIdentity(c, identityBackend);

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
          case 'to_delete':
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

  // DELETE /api/repos/:repo - Start async repo deletion via Step Functions
  app.delete('/api/repos/:repo', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c, identityBackend);

    let markedToDelete = false;

    try {
      const metadata = await repoManager.getRepoMetadata(repo);
      if (!metadata) {
        return sendError(NullType, variant('repository_not_found', { repo }));
      }

      // 1. Transition to 'to_delete' status. This acts as a lock: the repo status
      //    guard middleware blocks all new workspace operations on non-active repos.
      switch (metadata.status) {
        case 'active':
          await repoManager.setRepoStatus(repo, 'active', 'to_delete');
          markedToDelete = true;
          break;
        case 'to_delete':
          // Re-entry from a previous attempt. If an SFN is already running, return its ID.
          if (metadata.executionRef && deleteOrchestrator) {
            const status = await deleteOrchestrator.getDeletionStatus(metadata.executionRef);
            if (status.status === 'running') {
              return sendSuccessWithStatus(StringType, metadata.executionRef, 202);
            }
          }
          // SFN not running — re-check workspaces and restart below
          markedToDelete = true;
          break;
        case 'deleting':
          // Re-entry: past point of no return. If an SFN is already running, return its ID.
          if (metadata.executionRef && deleteOrchestrator) {
            const status = await deleteOrchestrator.getDeletionStatus(metadata.executionRef);
            if (status.status === 'running') {
              return sendSuccessWithStatus(StringType, metadata.executionRef, 202);
            }
          }
          // SFN not running (failed/completed/not found) — restart below
          markedToDelete = false; // don't rollback — data may be partially deleted
          break;
        case 'gc':
          return sendError(NullType, internalError(`Repository '${repo}' is currently running GC. Please wait for GC to complete.`));
        case 'creating':
          return sendError(NullType, internalError(`Repository '${repo}' is still being created. Please wait.`));
        default:
          return sendError(NullType, internalError(`Repository '${repo}' is in unexpected state '${metadata.status}'`));
      }

      // 2. If not already past point of no return, verify no workspaces exist.
      if (metadata.status !== 'deleting') {
        const workspaces = await listWorkspaces(repo);
        if (workspaces.length > 0) {
          await repoManager.setRepoStatus(repo, 'to_delete', 'active');
          markedToDelete = false;
          return sendError(NullType, internalError(`Repository '${repo}' still has ${workspaces.length} workspace(s). Delete all workspaces first.`));
        }
      }

      // 3. Start async deletion via Step Functions (or run synchronously if no orchestrator)
      if (deleteOrchestrator) {
        const executionId = await deleteOrchestrator.startDeletion({ repo });
        // Store execution ID on repo metadata so re-entry can detect a running SFN
        const currentStatus = metadata.status === 'deleting' ? 'deleting' as const : 'to_delete' as const;
        try { await repoManager.setRepoStatus(repo, currentStatus, currentStatus, executionId); }
        catch { /* best-effort — the SFN is already started */ }
        console.log(`Started repo deletion for '${repo}', executionId=${executionId}, requestedBy=${identity?.sub ?? 'unknown'}`);
        return sendSuccessWithStatus(StringType, executionId, 202);
      }

      // Fallback: synchronous deletion (for testing/local dev without SFN).
      // Note: does not delete S3 objects — acceptable since InMemoryStorage has no S3.
      await aclStore.deleteAllForRepo(repo);
      await deleteSchedulesForRepo(repo, scheduleStore, schedulerService);
      await taskConfigStore.deleteAllForRepo(repo);
      await userSettingsStore.deleteAllForRepo(repo);
      let cursor: string | undefined;
      do {
        const result = await repoStore.deleteRefsBatch(repo, cursor);
        cursor = result.cursor;
      } while (cursor);
      await repoStore.remove(repo);
      markedToDelete = false;
      console.log(`Repository '${repo}' deleted synchronously, deletedBy=${identity?.sub ?? 'unknown'}`);
      return sendSuccess(NullType, null);
    } catch (err) {
      if (markedToDelete) {
        // Roll back to 'active' so the repo isn't stuck in 'to_delete'
        try { await repoManager.setRepoStatus(repo, 'to_delete', 'active'); }
        catch { /* rollback is best-effort */ }
      }
      if (err instanceof InvalidRepoStatusError) {
        return sendError(NullType, internalError(err.message));
      }
      console.error('Failed to delete repo:', err);
      return sendError(NullType, internalError('Failed to delete repository'));
    }
  });

  // GET /api/repos/:repo/deletion/:executionId - Poll deletion status
  app.get('/api/repos/:repo/deletion/:executionId', async (c) => {
    const executionId = c.req.param('executionId');

    if (!deleteOrchestrator) {
      return sendError(StringType, internalError('Deletion orchestrator not configured'));
    }

    try {
      const status = await deleteOrchestrator.getDeletionStatus(executionId);
      switch (status.status) {
        case 'running':
          return sendSuccess(StringType, 'running');
        case 'succeeded':
          return sendSuccess(StringType, 'succeeded');
        case 'failed':
          return sendError(StringType, internalError(status.error ?? 'Deletion failed'));
        case 'not_found':
          return sendError(StringType, internalError('Deletion execution not found'));
      }
    } catch (err) {
      console.error('Failed to get deletion status:', err);
      return sendError(StringType, internalError('Failed to get deletion status'));
    }
  });

  return app;
}
