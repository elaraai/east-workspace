/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Repository lifecycle status.
 *
 * State transitions:
 *   CREATING → ACTIVE (on successful creation)
 *   ACTIVE → GC (on GC start)
 *   ACTIVE → TO_DELETE (on delete request, blocks workspace ops)
 *   GC → ACTIVE (on GC complete)
 *   TO_DELETE → ACTIVE (rollback if workspaces exist or precondition fails)
 *   TO_DELETE → DELETING (SFN confirmed empty, cleanup starting — point of no return)
 *   DELETING → (repo removed on successful SFN completion)
 *   DELETING stays DELETING on failure (requires admin investigation)
 *
 * Note: GC → TO_DELETE is blocked (must wait for GC to complete)
 */
export type RepoStatus = 'creating' | 'active' | 'gc' | 'to_delete' | 'deleting';

/**
 * Repository metadata.
 */
export interface RepoMetadata {
  /** Repository name */
  name: string;
  /** Current lifecycle status */
  status: RepoStatus;
  /** When the repo was created */
  createdAt: string;
  /** When the repo entered its current status */
  statusChangedAt: string;
  /** Opaque execution reference for current operation (if any) */
  executionRef?: string;
}

/**
 * Cloud-agnostic interface for repository lifecycle management.
 *
 * Handles creating, listing, deleting repos and transitioning
 * their lifecycle status (active, gc, to_delete, deleting).
 */
export interface RepoManager {
  /** List repositories. If includeAll is true, include non-active repos. */
  listRepos(includeAll?: boolean): Promise<string[]>;

  /** Get repository metadata, or null if not found. */
  getRepoMetadata(repo: string): Promise<RepoMetadata | null>;

  /** Create a new repository with status='active'. */
  createRepo(repo: string): Promise<void>;

  /**
   * Transition repository to a new status.
   *
   * @param repo - Repository name
   * @param expectedStatus - Current status(es) required for transition
   * @param newStatus - Target status
   * @param executionRef - Optional execution reference for tracking
   * @throws Error if current status doesn't match expected
   */
  setRepoStatus(
    repo: string,
    expectedStatus: RepoStatus | RepoStatus[],
    newStatus: RepoStatus,
    executionRef?: string,
  ): Promise<void>;

  /** Check if a repository exists. */
  repoExists(repo: string): Promise<boolean>;

  /** Remove only the repository metadata item. */
  removeRepoMetadata(repo: string): Promise<void>;
}
