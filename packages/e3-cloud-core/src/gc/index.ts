/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * @elaraai/e3-cloud-core/gc
 *
 * Cloud-agnostic GC step logic.
 *
 * Each step is a pure function that takes cloud-agnostic interfaces
 * and returns results. AWS Lambda handlers import from this module
 * and provide concrete AWS implementations via dependency injection.
 */

export { handleGcMark } from './gc-mark.js';
export type { GcMarkDeps, GcMarkInput, GcMarkOutput } from './gc-mark.js';

export { handleGcSweep } from './gc-sweep.js';
export type { GcSweepDeps, GcSweepInput, GcSweepOutput, GcSweepStats } from './gc-sweep.js';

export { handleGcCleanup } from './gc-cleanup.js';
export type { GcCleanupDeps, GcCleanupInput, GcCleanupOutput, GcCleanupStats } from './gc-cleanup.js';

export { handleGcScheduler, calculateJitter } from './gc-scheduler.js';
export type { GcSchedulerDeps, GcSchedulerInput, GcSchedulerOutput } from './gc-scheduler.js';

export { handleSetGC, handleSetActive } from './set-status.js';
export type { SetStatusDeps, SetStatusInput, SetStatusOutput } from './set-status.js';
