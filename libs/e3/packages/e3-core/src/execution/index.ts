/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Task execution for e3: the `TaskRunner` interface, the local runner, and
 * the process, scratch and jobs-budget mechanics beneath it.
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
  type DetachedArg,
  type DetachedSpec,
  type DetachedResult,
  type DetachedRunOptions,
} from './runDetached.js';

// Persistence-free process helpers (shared by tracked + detached paths)
export {
  marshalInputsToDir,
  type MarshalInputsOptions,
  marshalBytesToDir,
  readOutputFile,
  buildRunnerArgv,
  spawnAndCapture,
  type SpawnAndCaptureOptions,
  type SpawnAndCaptureResult,
} from './processExec.js';

export { materializeEnvironment } from './environment.js';

// Scratch directories of local executions
export { sweepScratchDirs, type SweepScratchOptions } from './scratch.js';

// The jobs budget of a local run
export { JobSlots, defaultJobs, cgroupCpuQuota, type ReleaseSlot } from './jobs.js';
