/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Task execution for e3: the `TaskRunner` interface, the local runner, and
 * the process, scratch and budget mechanics beneath it.
 */

export {
  type TaskExecuteOptions,
  type TaskResult,
  type TaskRunner,
  type SplitUnit,
} from './interfaces.js';

// TaskRunner implementations
export { LocalTaskRunner } from './LocalTaskRunner.js';
export { MockTaskRunner, type MockTaskCall, type MockUnitCall } from './MockTaskRunner.js';

// The engine: a task split into pieces, as the stages its units run in
export {
  SplitTask,
  isSplitTask,
  type SplitStage,
  type ThrownUnit,
} from './engine.js';

// Graph-free execution (functions / one-shot)
export {
  runDetached,
  type DetachedSpec,
  type DetachedResult,
  type DetachedRunOptions,
} from './runDetached.js';

// Persistence-free process helpers (shared by tracked + detached paths)
export {
  marshalInputsToDir,
  type MarshalInputsOptions,
  spawnAndCapture,
  type SpawnAndCaptureOptions,
  type SpawnAndCaptureResult,
} from './processExec.js';

export { materializeEnvironment } from './environment.js';

// Scratch directories of local executions
export { sweepScratchDirs } from './scratch.js';

// The budget of an e3 process: its cores and memory
export {
  Budget,
  resolveBudget,
  defaultCores,
  defaultMemory,
  parseMemory,
  cgroupCpuQuota,
  cgroupMemoryMax,
  unitThreads,
  UNIT_MAX_THREADS,
  DOOR_FRAME_WORKERS,
  type BudgetCapacity,
  type BudgetRequest,
  type BudgetSettings,
  type ReleaseSlot,
} from './budget.js';
