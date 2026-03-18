/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Set Delete Status — Status transitions for the repo deletion state machine.
 */

import type { RepoManager, RepoStatus } from '../repo-manager.js';
import type { RepoStore } from '@elaraai/e3-core';
import { InvalidRepoStatusError } from '../errors.js';

export interface SetDeleteStatusDeps {
  repoManager: RepoManager;
  repoStore: RepoStore;
}

export interface SetDeleteStatusInput {
  repo: string;
}

export interface SetDeleteStatusOutput {
  repo: string;
  status: RepoStatus | 'removed';
  success: boolean;
  error?: string;
}

/**
 * Transition to_delete → deleting (point of no return).
 * Called by the SFN after confirming no workspaces exist, before cleanup begins.
 * After this, rollback is not possible — partial deletion may have occurred.
 */
export async function handleSetDeleting(
  deps: SetDeleteStatusDeps,
  input: SetDeleteStatusInput,
): Promise<SetDeleteStatusOutput> {
  const { repo } = input;

  try {
    await deps.repoManager.setRepoStatus(repo, 'to_delete', 'deleting');
    console.log(`Transitioned ${repo} from to_delete to deleting (point of no return)`);
    return { repo, status: 'deleting', success: true };
  } catch (error) {
    if (error instanceof InvalidRepoStatusError) {
      console.error(`Failed to set deleting for ${repo}: ${error.message}`);
      return { repo, status: error.actualStatus as RepoStatus, success: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Roll back repo from 'to_delete' → 'active'.
 * Called by the SFN Catch state on precondition failures (e.g., workspaces still exist).
 * Only valid while repo is in 'to_delete' state — once 'deleting', rollback is not attempted.
 */
export async function handleRollbackDelete(
  deps: SetDeleteStatusDeps,
  input: SetDeleteStatusInput,
): Promise<SetDeleteStatusOutput> {
  const { repo } = input;

  // Check current status — only rollback from 'to_delete', not from 'deleting'
  const metadata = await deps.repoManager.getRepoMetadata(repo);
  if (metadata?.status === 'deleting') {
    console.error(`Repo ${repo} is in 'deleting' state — cannot rollback, requires admin investigation`);
    return { repo, status: 'deleting', success: false, error: 'Repo is past point of no return (deleting). Requires admin investigation.' };
  }

  try {
    await deps.repoManager.setRepoStatus(repo, 'to_delete', 'active');
    console.log(`Rolled back ${repo} from to_delete to active`);
    return { repo, status: 'active', success: true };
  } catch (error) {
    if (error instanceof InvalidRepoStatusError) {
      console.error(`Failed to rollback delete for ${repo}: ${error.message}`);
      return { repo, status: error.actualStatus as RepoStatus, success: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Remove repo metadata — the final step after all data is cleaned up.
 */
export async function handleRemoveRepo(
  deps: SetDeleteStatusDeps,
  input: SetDeleteStatusInput,
): Promise<SetDeleteStatusOutput> {
  const { repo } = input;

  console.log(`Removing repo metadata for ${repo}`);
  await deps.repoManager.removeRepoMetadata(repo);
  console.log(`Repository '${repo}' deleted successfully`);
  return { repo, status: 'removed', success: true };
}
