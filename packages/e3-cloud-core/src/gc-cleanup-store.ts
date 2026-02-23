/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Cloud-agnostic interface for GC cleanup operations.
 *
 * The cleanup phase needs cloud-specific version management to delete
 * orphaned object versions. On AWS this involves S3 versioning;
 * on Azure it could be Blob snapshots.
 */
export interface GcCleanupStore {
  /** Clean up orphaned object versions in cloud storage */
  cleanupOrphanedVersions(repo: string): Promise<void>;
}
