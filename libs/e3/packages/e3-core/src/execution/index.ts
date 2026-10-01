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
  type RunningExecution,
  type ExecutionLiveness,
  type MergeParts,
  type SplitUnit,
  type UnitRequeue,
  type IntakeSource,
  type IntakeSpec,
  type IntakeOptions,
  type IntakeResult,
} from './interfaces.js';

// A local runner's intake of a delivered collection, on east-c or east-node
export { runIntake, INTAKE_CANDIDATES, type IntakeCandidate, type RunIntakeOptions } from './intake.js';

// TaskRunner implementations
export { LocalTaskRunner } from './LocalTaskRunner.js';
export { MockTaskRunner, type MockTaskCall, type MockTaskResult, type MockUnitCall } from './MockTaskRunner.js';

// An execution attempt's records, as every runner writes them
export {
  ExecutionAttempt,
  readTaskObject,
  toTaskResult,
  type AttemptRunner,
  type LogAppender,
} from './attempt.js';

// The units a task runs as, wherever they run, and where each one's output is
export {
  UNIT_FILE,
  UNIT_RESULT_FILE,
  UNIT_OUTPUT_DIR,
  OUTPUT_MERGE_FILE,
  OUTPUT_MERGE_RESULT,
  OUTPUT_MERGE_DIR,
  INTAKE_TYPE_FILE,
  INTAKE_OUTPUT_FILE,
  runUnitOf,
  mergeUnitOf,
  callUnitOf,
  intakeUnitOf,
  emitsRuns,
  outputRunsOf,
  outputMergeUnitOf,
  unitOutputOf,
  emittedCollectionType,
  type StockRunner,
  type UnitForm,
  type UnitStage,
  type UnitOutputPlace,
} from './unit-forms.js';

// The engine: a task split into pieces, as the stages its units run in, and
// the driver that runs a task on its own — whose judgement of what still runs
// is this machine's unless its caller gives its runner's
export {
  SplitTask,
  isSplitTask,
  stageUnits,
  type SplitStage,
  type ThrownUnit,
  type UnitExecutor,
} from './engine.js';
export { executeSplitTask, type SplitTaskDriver } from './LocalTaskRunner.js';

// The pieces of a split task, where a host reads the piece size a test sets,
// and the merge fan-in of its sorted partials
export {
  PIECE_SIZES,
  pieceSizes,
  pieceBoundaries,
  planPieces,
  readTestPieceBytesFrom,
  type PieceSizes,
  type SplitPoint,
  type PiecePlan,
} from './pieces.js';
export {
  MERGE_TREE_FANIN,
  mergeComponents,
  planMergeRanges,
  mergeTreeGroups,
  mergeTreeLevels,
  type MergeComponent,
} from './steps.js';

// Graph-free execution (functions / one-shot)
export { runDetached } from './runDetached.js';
export {
  type DetachedArg,
  type DetachedSpec,
  type DetachedResult,
  type DetachedRunOptions,
} from './interfaces.js';

// One-shot: a caller's IR run once under the grant the host's auth gives it,
// and the limits and result every graph-free call shares
export {
  oneShotExecute,
  oneShotPlatformUse,
  resolveExecuteLimits,
  resolveJobLimits,
  detachedToExecuteResult,
  invalidExecuteResult,
  type OneShotGrant,
  type OneShotOptions,
  type ExecuteCeilings,
  type ResolvedLimits,
} from './oneShot.js';

// Split calls: a caller's program run over a dataset's pieces as a job, under
// one-shot's grant
export {
  splitCallPlatformUse,
  splitCallPlatformFree,
  splitCallPrepare,
  splitCallReference,
  splitCallExplain,
  splitCallRun,
  splitCallResult,
  splitCallInvalid,
  SplitCallOutcomeType,
  type SplitCallOutcome,
  type SplitCallTask,
  type SplitCallOptions,
  type SplitCallRunOptions,
} from './splitCall.js';

// Persistence-free process helpers (shared by tracked + detached paths)
export {
  marshalInputsToDir,
  stageInput,
  type MarshalInputsOptions,
  spawnAndCapture,
  type SpawnAndCaptureOptions,
  type SpawnAndCaptureResult,
} from './processExec.js';

// A unit's segments placed as its runner reads them, where placing an object
// is a download
export { SegmentFetcher } from './segment-fetch.js';

// An execution environment: its local build, and the reading of the files an
// environment names, which a remote builder does too
export { materializeEnvironment, decodeEnvironmentFile, nodeLockFilename } from './environment.js';

// Scratch directories of local executions
export { sweepScratchDirs } from './scratch.js';

// The budget of an e3 process: its cores and memory, and the guard that
// watches what its runners use
export {
  Budget,
  resolveBudget,
  defaultCores,
  defaultMemory,
  parseMemory,
  unitThreads,
  UNIT_MAX_THREADS,
  DOOR_FRAME_WORKERS,
  type BudgetCapacity,
  type BudgetOptions,
  type BudgetRequest,
  type BudgetSettings,
  type Grant,
  type GrantKind,
  type GuardStop,
  type WatchedRunner,
} from './budget.js';
export {
  defaultMemorySampler,
  type MachineMemory,
  type MeasuredRunner,
  type MemorySampler,
} from './memory.js';

// cgroup v2: the limits of the cgroups this process runs in, and a cgroup of
// its own for each unit where its cgroup is delegated to e3
export { cgroupCpuQuota, cgroupMemoryMax, unitCap } from './cgroups.js';
