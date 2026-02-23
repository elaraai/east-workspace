/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Storage interface for per-user per-workspace settings.
 *
 * Settings are stored as opaque binary blobs (application/octet-stream).
 * The cloud platform imposes no schema — the webapp is free to encode
 * the payload however it likes.
 *
 * Implementations:
 * - DynamoUserSettingsStore (e3-aws) - DynamoDB-backed
 * - InMemoryUserSettingsStore (e3-cloud-core/testing) - for unit tests
 */
export interface UserSettingsStore {
  /** Get settings for a user in a workspace (null if none). */
  get(repo: string, workspace: string, userId: string): Promise<Uint8Array | null>;

  /**
   * Put settings for a user in a workspace.
   * @throws {WorkspaceNotFoundError} if the workspace does not exist
   * @throws {WorkspaceLockedError} if the workspace is locked
   */
  put(repo: string, workspace: string, userId: string, data: Uint8Array): Promise<void>;

  /** Delete settings for a user in a workspace. */
  delete(repo: string, workspace: string, userId: string): Promise<void>;

  /** Delete all user settings for a workspace (workspace deletion cleanup). */
  deleteAllForWorkspace(repo: string, workspace: string): Promise<void>;

  /** Delete all user settings for a repo (repo deletion cleanup). */
  deleteAllForRepo(repo: string): Promise<void>;
}
