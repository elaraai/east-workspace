/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Extended storage interface for cloud dataflow operations.
 *
 * Extends the core StorageBackend with:
 * - ExecutionStateStore for managing dataflow execution state
 * - Lock extensions (renewLock, forceRelease) needed by Step Functions
 * - Cloud-specific stores (RepoManager, DataflowRunStore, ExecutionTracker)
 *
 * S3DynamoStorage structurally satisfies this interface.
 */

import type { StorageBackend, LockService, ExecutionStateStore } from '@elaraai/e3-core';
import type { RepoManager } from './repo-manager.js';
import type { DataflowRunStore } from './dataflow-run-store.js';
import type { ExecutionTracker } from './execution-tracker.js';

/**
 * Extended lock service with cloud-specific operations.
 *
 * Cloud lock implementations support:
 * - renewLock: Extend TTL during long-running dataflows
 * - forceRelease: Unconditional release (for cleanup after errors)
 */
export interface CloudLockService extends LockService {
  renewLock(repo: string, resource: string): Promise<boolean>;
  forceRelease(repo: string, resource: string): Promise<void>;
}

/**
 * Complete storage interface for cloud dataflow operations.
 *
 * Extends StorageBackend with execution state management, cloud-specific
 * lock operations, and tracking stores needed by the Step Functions
 * orchestration layer.
 */
export interface DataflowStorage extends StorageBackend {
  /** Execution state persistence (read/write/update execution states) */
  readonly executions: ExecutionStateStore;
  /** Extended lock service with renewLock and forceRelease */
  readonly locks: CloudLockService;
  /** Repository lifecycle management */
  readonly repoManager: RepoManager;
  /** Dataflow run tracking (per-workspace run history) */
  readonly dataflowRuns: DataflowRunStore;
  /** Execution/task status tracking for the polling loop */
  readonly executionTracker: ExecutionTracker;
}
