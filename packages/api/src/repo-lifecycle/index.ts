/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Repository Lifecycle Handlers
 *
 * Lambda handlers for repository lifecycle operations (create, GC, delete).
 * These are invoked by Step Functions state machines.
 */

// Delete handlers
export {
  handler as deleteBatchHandler,
  type DeleteBatchInput,
  type DeleteBatchOutput,
} from './delete-batch.js';

// Status transition handlers
export {
  setDeletingHandler,
  setGCHandler,
  setActiveHandler,
  removeMetadataHandler,
  type SetStatusInput,
  type SetStatusOutput,
} from './set-status.js';

// GC handlers
export {
  handler as gcMarkHandler,
  type GcMarkInput,
  type GcMarkOutput,
} from './gc-mark.js';

export {
  handler as gcSweepHandler,
  type GcSweepInput,
  type GcSweepOutput,
  type GcSweepStats,
} from './gc-sweep.js';

export {
  handler as gcCleanupHandler,
  type GcCleanupInput,
  type GcCleanupOutput,
} from './gc-cleanup.js';

export {
  handler as gcSchedulerHandler,
  type GcSchedulerInput,
  type GcSchedulerOutput,
} from './gc-scheduler.js';
