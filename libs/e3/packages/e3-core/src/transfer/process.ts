/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared processing handlers for the jobs that outlast a request: package
 * import and export, workspace deploy, repository gc, split calls and the
 * loads of composite records' deliveries.
 *
 * These are cloud-agnostic handlers that perform the actual work of each job.
 * Used by both the local InMemoryTransferBackend and cloud backends
 * (e.g. AWS Lambda/Step Functions). An import reads its zip from a source read
 * by ranges, and an export writes its zip to a WHATWG stream; a job whose zip
 * is a file on this machine, or a Node stream, is the root entry's
 * (`process-files.ts`).
 */

import { none, some, variant } from '@elaraai/east';
import type { InputPlan, RecordIndexPlan, RecordLoadProgress, RecordLoadResult, RecordPlan } from '@elaraai/e3-types';

import { ExportStoppedError, RecordLoadStoppedError } from '../errors.js';
import { recordLoad } from '../record-load.js';
import { repoGc } from '../gc.js';
import { packageExport, packageImportFrom, type PackageExportOptions, type PackageExportResult } from '../packages.js';
import { workspaceDeploy, workspaceExport, type WorkspaceExportOptions, type WorkspaceExportResult } from '../workspaces.js';
import { withRunningWork } from '../running-work.js';
import type { LockHandle, StorageBackend } from '../storage/interfaces.js';
import type { RunningExecution, TaskRunner } from '../execution/interfaces.js';
import { splitCallExplain, splitCallReference, splitCallRun, type SplitCallTask } from '../execution/splitCall.js';
import { openZip, zipSinkOf, zipSourceOf, type ZipReader, type ZipSource } from '../zip.js';
import type { PackageExportStore, PackageImportStore, RecordLoadStore, RepoGcStore, SplitCallStore, WorkspaceDeployStore } from './interfaces.js';
import { heldProgress } from './job-progress.js';
import type { PackageZipCheckpoint } from './types.js';

// =============================================================================
// Throttled progress callback
// =============================================================================

/**
 * Creates a progress callback that throttles updates to at most once per interval.
 *
 * @param fn - The function to call with throttled updates
 * @param intervalMs - Minimum interval between calls in milliseconds
 * @returns A throttled version of the progress callback
 */
function throttledProgress(
  fn: (progress: { objectsProcessed: number }) => Promise<void>,
  intervalMs = 1000,
) {
  let lastCall = 0;
  let pending: { objectsProcessed: number } | null = null;

  const throttled = async (progress: { objectsProcessed: number }) => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      lastCall = now;
      pending = null;
      await fn(progress);
    } else {
      pending = progress;
    }
  };

  throttled.flush = async () => {
    if (pending) {
      await fn(pending);
      pending = null;
    }
  };

  return throttled;
}

// =============================================================================
// Process Export
// =============================================================================

/** Dependencies for handleProcessExport. */
export interface ProcessExportDeps {
  storage: StorageBackend;
  exportStore: PackageExportStore;
  /**
   * The workspace lock, when the caller holds it, for a workspace's export.
   * The export takes none of its own and leaves this one held, so a caller
   * that runs one job over several calls holds the workspace from the first
   * to the last: nothing changes it in between, and so the export's resume is
   * never refused for a workspace that changed. A package's export takes no
   * lock, and leaves it alone.
   *
   * @remarks
   * The caller takes it through `acquireWorkspaceExclusive`, as an export
   * takes its own: that announces the export, which stops a dataflow running
   * in the workspace and holds every new write and run start off.
   */
  lock?: LockHandle;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a large export has finished. The export
   * stops once the entry it is writing is written, and the call throws an
   * {@link ExportStoppedError} whose checkpoint the next call resumes from,
   * with the job left `processing`.
   */
  signal?: AbortSignal;
}

/** Input for handleProcessExport. */
export interface ProcessExportInput {
  id: string;
  repo: string;
  /** The stream the zip is written to, such as a multipart upload, which the
   *  export closes once the zip is whole. */
  zip: WritableStream<Uint8Array>;
  /** The checkpoint a call of this job that was stopped handed over: the
   *  export goes on from it, and `zip` holds the bytes it counts. */
  resume?: PackageZipCheckpoint;
}

/**
 * How an export job writes its zip: a package's export, or a workspace's,
 * each to where the job's zip goes.
 *
 * @internal
 */
export interface ExportZip {
  /** Exports a package. */
  package(name: string, version: string, options: PackageExportOptions): Promise<PackageExportResult>;
  /** Exports a workspace as the package it names. */
  workspace(workspace: string, name: string, version: string, options: WorkspaceExportOptions): Promise<WorkspaceExportResult>;
  /** Removes what an export that failed wrote, before its job is recorded
   *  failed. */
  discard?(): Promise<void>;
}

/**
 * Processes a package or workspace export job.
 *
 * Gets the export record, determines whether this is a package or workspace
 * export (based on the `workspace` field), runs the appropriate export
 * function, and updates the status to completed or failed.
 *
 * @remarks
 * The zip is written to a WHATWG stream, which the export closes once the zip
 * is whole; a call stopped at its signal leaves it open, holding the bytes the
 * checkpoint counts, for the call that goes on. A zip written to a file on
 * this machine, or to a Node stream, is the root entry's job.
 *
 * @param deps - Storage backend, export store, and the caller's workspace lock
 *   and the signal that stops the call
 * @param input - Job ID, repository path, the stream the zip is written to,
 *   and the checkpoint it resumes from
 *
 * @throws {ExportStoppedError} When `deps.signal` stopped the export, with the
 *   job left `processing`.
 * @throws {TypeError} When the zip is no `WritableStream`: a path or a Node
 *   stream, which the root entry writes to.
 * @throws Re-throws errors after updating status to failed
 */
export async function handleProcessExport(
  deps: ProcessExportDeps,
  input: ProcessExportInput,
): Promise<void> {
  const sink = zipSinkOf(input.zip, 'export job');
  const { storage } = deps;
  const { repo } = input;
  return handleProcessExportWith(deps, input, {
    package: (name, version, options) => packageExport(storage, repo, name, version, sink, options),
    workspace: (workspace, name, version, options) => workspaceExport(storage, repo, workspace, sink, name, version, options),
  });
}

/**
 * Processes an export job as {@link handleProcessExport} does, writing its zip
 * through `zip`: what the root entry's job writes a file or a Node stream
 * through.
 *
 * @param zip - Writes the job's zip, and removes what a failed one wrote
 * @internal
 */
export async function handleProcessExportWith(
  deps: ProcessExportDeps,
  input: { id: string; resume?: PackageZipCheckpoint },
  zip: ExportZip,
): Promise<void> {
  const { exportStore, lock, signal } = deps;
  const { id, resume } = input;

  const record = await exportStore.get(id);
  if (!record) throw new Error(`Export record ${id} not found`);

  const onProgress = throttledProgress(async ({ objectsProcessed }) => {
    await exportStore.updateStatus(id,
      variant('processing', variant('exporting', { objectsProcessed: BigInt(objectsProcessed) })));
  });

  try {
    const result = record.workspace.type === 'some'
      ? await zip.workspace(record.workspace.value, record.name, record.version, { onProgress, lock, signal, resume })
      : await zip.package(record.name, record.version, { onProgress, signal, resume });
    await onProgress.flush();
    await exportStore.updateStatus(id, variant('completed', {
      size: BigInt(result.bytes),
    }));
  } catch (err) {
    // A call its caller stopped hands over, and the job goes on.
    if (err instanceof ExportStoppedError) throw err;
    await zip.discard?.();
    const message = err instanceof Error ? err.message : String(err);
    await exportStore.updateStatus(id, variant('failed', { message }));
    throw err;
  }
}

// =============================================================================
// Process Import
// =============================================================================

/** Dependencies for handleProcessImport. */
export interface ProcessImportDeps {
  storage: StorageBackend;
  importStore: PackageImportStore;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a large import has finished. The import
   * stops between entries, and the job is left `processing` with its zip where
   * it lies: the next call reads only the objects the store does not hold.
   */
  signal?: AbortSignal;
}

/** Input for handleProcessImport. */
export interface ProcessImportInput {
  id: string;
  repo: string;
  /** The staged zip: a source read by ranges where it lies, which its owner
   *  removes. */
  zip: ZipSource;
}

/**
 * The zip an import job takes in: its size, how it opens, and what removes it
 * once the job is done with it.
 *
 * @internal
 */
export interface ImportZip {
  /** The zip's size in bytes. */
  size(): Promise<number>;
  /** Opens the zip. */
  open(): Promise<ZipReader>;
  /** Removes the zip, once the job has ended rather than been handed over. */
  discard?(): Promise<void>;
}

/**
 * Processes a package import job.
 *
 * Gets the import record, verifies the zip's size matches, runs packageImport,
 * and updates the status to completed or failed.
 *
 * @remarks
 * The zip is read by ranges where it lies, through its source, which its
 * owner removes. A staged zip that is a file on this machine is the root
 * entry's job, which removes the file once the job ends.
 *
 * @param deps - Storage backend, import store, and the signal that stops the
 *   call
 * @param input - Job ID, repository path, and the staged zip
 *
 * @throws {TypeError} When the zip is a path, which the root entry reads.
 * @throws Re-throws errors after updating status to failed; or, when
 *   `deps.signal` has aborted, with the job left `processing`
 */
export async function handleProcessImport(
  deps: ProcessImportDeps,
  input: ProcessImportInput,
): Promise<void> {
  const zip = zipSourceOf(input.zip, 'import job');
  return handleProcessImportWith(deps, input, { size: () => Promise.resolve(zip.size), open: () => openZip(zip) });
}

/**
 * Processes an import job as {@link handleProcessImport} does, reading its zip
 * through `zip`: what the root entry's job reads a file through.
 *
 * @param zip - The zip's size, its opening, and its removal
 * @internal
 */
export async function handleProcessImportWith(
  deps: ProcessImportDeps,
  input: { id: string; repo: string },
  zip: ImportZip,
): Promise<void> {
  const { storage, importStore, signal } = deps;
  const { id, repo } = input;

  const record = await importStore.get(id);
  if (!record) throw new Error(`Import record ${id} not found`);

  // Verify the zip's size matches
  const size = await zip.size();
  if (BigInt(size) !== record.size) {
    const message = `size mismatch: expected ${record.size}, got ${size}`;
    await importStore.updateStatus(id, variant('failed', { message }));
    await zip.discard?.();
    throw new Error(message);
  }

  let handedOver = false;
  try {
    const onProgress = throttledProgress(async ({ objectsProcessed }) => {
      await importStore.updateStatus(id,
        variant('processing', variant('importing', { objectsProcessed: BigInt(objectsProcessed) })));
    });

    const result = await packageImportFrom(storage, repo, () => zip.open(), { onProgress, signal });

    await onProgress.flush();
    await importStore.updateStatus(id, variant('completed', {
      name: result.name,
      version: result.version,
      packageHash: result.packageHash,
      objectCount: BigInt(result.objectCount),
    }));
  } catch (err) {
    // A call its caller stopped hands over: the job goes on, from the zip.
    if (signal?.aborted === true) {
      handedOver = true;
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    await importStore.updateStatus(id, variant('failed', { message }));
    throw err;
  } finally {
    if (!handedOver) await zip.discard?.();
  }
}

// =============================================================================
// Process Deploy
// =============================================================================

/** Dependencies for handleProcessDeploy. */
export interface ProcessDeployDeps {
  storage: StorageBackend;
  deployStore: WorkspaceDeployStore;
  /** Runs the deploy's migrations and index builds. Without one, a deploy
   *  that owes either is refused before it writes anything. */
  runner?: TaskRunner;
  /**
   * The workspace lock, when the caller holds it. The deploy takes none of
   * its own and leaves this one held, so a caller that runs one job over
   * several calls holds the workspace from the first to the last: no dataflow
   * or other deploy takes it in between.
   *
   * @remarks
   * The caller takes it through `acquireWorkspaceExclusive`, as a deploy
   * takes its own: that announces the deploy, which stops a dataflow running
   * in the workspace and holds every new write and run start off. A lock
   * taken any other way waits behind a dataflow for as long as it runs.
   */
  lock?: LockHandle;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a long deploy has finished. A deploy that
   * throws once it has aborted leaves the job `processing` rather than
   * `failed`: its steps run before it writes a ref, and the call that runs it
   * again is served the ones that finished from the execution cache.
   */
  signal?: AbortSignal;
}

/** Input for handleProcessDeploy. */
export interface ProcessDeployInput {
  id: string;
  repo: string;
}

/**
 * Processes a workspace deploy job.
 *
 * Gets the job, deploys its package to its workspace, and updates the status
 * to what the deploy decided for each record, index and input, or to why it
 * failed.
 *
 * @remarks
 * The deploy runs for a client, on a machine that is not the client's, so it
 * never reads a `file` source, whose path is on the client's machine: each is
 * left unassigned, with a warning in the result, and the client completes it
 * over the dataset transfer protocol.
 *
 * @param deps - Storage backend, deploy store, the runner the deploy's
 *   migrations and index builds run on, and the caller's workspace lock and
 *   signal
 * @param input - Job ID and repository path
 *
 * @throws Re-throws the deploy's error once the job is recorded `failed`, or,
 *   when `deps.signal` has aborted, with the job left `processing`
 */
export async function handleProcessDeploy(
  deps: ProcessDeployDeps,
  input: ProcessDeployInput,
): Promise<void> {
  const { storage, deployStore, runner, lock, signal } = deps;
  const { id, repo } = input;

  const record = await deployStore.get(id);
  if (!record) throw new Error(`Deploy record ${id} not found`);

  await deployStore.updateStatus(id, variant('processing', variant('deploying', none)));
  const records: RecordPlan[] = [];
  const indexes: RecordIndexPlan[] = [];
  const inputs: InputPlan[] = [];
  const warnings: string[] = [];
  try {
    await workspaceDeploy(storage, repo, record.workspace, record.packageName, record.packageVersion, {
      schema: record.schema.type,
      inputs: record.inputs.type,
      allowDropRecords: record.allowDropRecords,
      plan: record.plan,
      resolveFileSources: false,
      sourceWarning: (message) => { warnings.push(message); },
      ...(runner !== undefined && { runner }),
      ...(lock !== undefined && { lock }),
      onRecordPlan: (plan) => { records.push(plan); },
      onRecordIndex: (plan) => { indexes.push(plan); },
      onInputPlan: (plan) => { inputs.push(plan); },
      // A client polling the job reads how far it has got.
      onDeployProgress: (progress) => deployStore.updateStatus(id, variant('processing', variant('deploying', some(progress)))),
    });
    await deployStore.updateStatus(id, variant('completed', { records, indexes, inputs, warnings }));
  } catch (err) {
    // A call its caller stopped is handed over, not failed.
    if (signal?.aborted === true) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await deployStore.updateStatus(id, variant('failed', { message }));
    throw err;
  }
}

// =============================================================================
// Process GC
// =============================================================================

/** Dependencies for handleProcessGc. */
export interface ProcessGcDeps {
  storage: StorageBackend;
  gcStore: RepoGcStore;
  /** The repository's runner, whose judgement of whether an execution
   *  recorded running can still finish (`TaskRunner.executionAlive`) gc's
   *  history prune takes: one that cannot is recorded interrupted, and pruned.
   *  Without one, every execution recorded running is kept. */
  runner?: TaskRunner;
}

/** Input for handleProcessGc. */
export interface ProcessGcInput {
  id: string;
  repo: string;
}

/**
 * Processes a gc job.
 *
 * Gets the job, runs gc over its repository as it was asked to, and updates
 * the status to what gc did, or to why it failed.
 *
 * @param deps - Storage backend, gc store, and the repository's runner, whose
 *   judgement of what still runs the history's prune takes
 * @param input - Job ID and repository identifier
 *
 * @throws Re-throws gc's error once the job is recorded `failed`
 */
export async function handleProcessGc(
  deps: ProcessGcDeps,
  input: ProcessGcInput,
): Promise<void> {
  const { storage, gcStore, runner } = deps;
  const { id, repo } = input;

  const record = await gcStore.get(id);
  if (!record) throw new Error(`gc record ${id} not found`);

  const { dryRun } = record.request;
  const [minAge, keepRuns, keepDays] = [record.request.minAge, record.request.keepRuns, record.request.keepDays]
    .map((option) => (option.type === 'some' ? Number(option.value) : undefined));
  try {
    const result = await repoGc(storage, repo, {
      dryRun, minAge, keepRuns, keepDays,
      ...(runner !== undefined && { executionAlive: (s: StorageBackend, task: string, inputs: string, running: RunningExecution) => runner.executionAlive(s, task, inputs, running) }),
    });
    await gcStore.updateStatus(id, {
      status: variant('succeeded', null),
      stats: some({
        deletedObjects: BigInt(result.deletedObjects),
        deletedPartials: BigInt(result.deletedPartials),
        retainedObjects: BigInt(result.retainedObjects),
        skippedYoung: BigInt(result.skippedYoung),
        bytesFreed: BigInt(result.bytesFreed),
        deletedRuns: BigInt(result.deletedRuns),
        deletedExecutions: BigInt(result.deletedExecutions),
      }),
      error: none,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await gcStore.updateStatus(id, { status: variant('failed', null), stats: none, error: some(message) });
    throw err;
  }
}

// =============================================================================
// Process Split Call
// =============================================================================

/** Dependencies for handleProcessSplitCall. */
export interface ProcessSplitCallDeps {
  storage: StorageBackend;
  splitCallStore: SplitCallStore;
  /** Runs the call's units, and its `then`. */
  runner: TaskRunner;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a large split call has finished. The job is
   * left `processing`, and the call that runs it again is served the units
   * that finished from the execution cache, within what is left of the job's
   * timeout.
   */
  signal?: AbortSignal;
  /**
   * How many units a `first` call's job keeps running at once (#1110), 4 by
   * default (`FIRST_CALL_WIDTH`): the local server's budget's cores, e3-web's
   * pool's width, e3-cloud's `splitCalls.width`.
   */
  width?: number;
}

/** Input for handleProcessSplitCall. */
export interface ProcessSplitCallInput {
  id: string;
  repo: string;
}

/** The least time between two writes of a split call's progress to its store. */
const SPLIT_PROGRESS_INTERVAL_MS = 500;

/** How often a running split call's job reads its record, to find it ended:
 *  cancelled by a caller who may poll it. */
export const SPLIT_CANCEL_POLL_MS = 1_000;

/**
 * Processes a split call job.
 *
 * Gets the job, runs its task over its pieces and then its `then`
 * (`splitCallRun`) holding the repository's running work, and updates the
 * status to what the call came to, or to why e3 could not run it. A client
 * polling the job reads how far it has got, written as the units go. The
 * job's timeout counts from its launch (`createdAt`), so a call that goes on
 * with a job handed over gets what is left of it.
 *
 * An explain's job plans the call's pieces instead (`splitCallExplain`), as
 * the call's run would plan them, runs no unit, and ends `planned`; a launch
 * that follows plans them again and finds the pieces the explain stored. Either
 * re-references what the call's `object` arguments name first
 * (`splitCallReference`), and ends `completed`, `invalid`, when the store no
 * longer holds one whole.
 *
 * A job is cancelled by writing it `cancelled` to its store. While it runs, the
 * job reads its record every {@link SPLIT_CANCEL_POLL_MS}, and a progress write
 * the store refuses says the same. Once it finds the job has ended, it stops
 * its run or its planning: the runner stops the units running, and the units
 * that finished stay cached, so a relaunch is served them. A job found ended
 * before it starts runs nothing.
 *
 * @param deps - Storage backend, split call store, the runner the call's units
 *   run on, and the caller's signal
 * @param input - Job ID and repository identifier
 *
 * @throws Re-throws the error that stopped the call once the job is recorded
 *   `failed`, or, when `deps.signal` has aborted, with the job left
 *   `processing`; a job stopped because it was cancelled returns
 */
export async function handleProcessSplitCall(
  deps: ProcessSplitCallDeps,
  input: ProcessSplitCallInput,
): Promise<void> {
  const { storage, splitCallStore, runner, signal, width } = deps;
  const { id, repo } = input;

  const record = await splitCallStore.get(id);
  if (!record) throw new Error(`Split call ${id} not found`);
  if (record.status.type !== 'processing') return;
  const call: SplitCallTask = {
    task: record.task,
    inputs: record.inputs,
    objects: record.objects.map(Number),
    then: record.then.type === 'some' ? record.then.value : null,
    first: record.first.type === 'some' ? Number(record.first.value) : null,
    limits: {
      timeoutMs: Number(record.limits.timeoutMs),
      maxResultBytes: Number(record.limits.maxResultBytes),
      maxLogBytes: Number(record.limits.maxLogBytes),
    },
    read: record.read,
  };

  // The job's own signal: the caller's, which hands the job over, and the
  // job's end, once it is found cancelled.
  const ended = new AbortController();
  const end = (): void => {
    if (!ended.signal.aborted) ended.abort(new Error(`split call ${id} was cancelled`));
  };
  const jobSignal = signal === undefined ? ended.signal : AbortSignal.any([signal, ended.signal]);
  const watch = setInterval(() => {
    splitCallStore.get(id).then((current) => {
      if (current === null || current.status.type !== 'processing') end();
    }, () => {
      // A read that fails leaves the job running: the next one looks again.
    });
  }, SPLIT_CANCEL_POLL_MS);

  // Progress is written one write at a time, and the last before the outcome.
  let reported = 0;
  let writes: Promise<void> = Promise.resolve();
  try {
    if (record.explain) {
      const status = await withRunningWork(storage, repo, async () => {
        const unheld = await splitCallReference(storage, repo, call);
        return unheld === null
          ? variant('planned', await splitCallExplain(storage, repo, call, { signal: jobSignal }))
          : variant('completed', unheld);
      });
      await splitCallStore.updateStatus(id, status);
      return;
    }
    const outcome = await withRunningWork(storage, repo, () => splitCallRun(storage, runner, repo, call, {
      signal: jobSignal,
      launchedAt: record.createdAt,
      ...(width !== undefined && { width }),
      onProgress: (progress) => {
        const now = Date.now();
        if (now - reported < SPLIT_PROGRESS_INTERVAL_MS) return;
        reported = now;
        writes = writes.then(async () => {
          // Refused: the job has ended.
          if (!await splitCallStore.updateStatus(id, variant('processing', some(progress)))) end();
        }).catch(() => {
          // A progress write that fails leaves the last one standing.
        });
      },
    }));
    await writes;
    await splitCallStore.updateStatus(id, variant('completed', outcome));
  } catch (err) {
    await writes;
    // A call cancelled has ended already: its record says so.
    if (ended.signal.aborted) return;
    // A call its caller stopped is handed over, not failed.
    if (signal?.aborted === true) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await splitCallStore.updateStatus(id, variant('failed', { message }));
    throw err;
  } finally {
    clearInterval(watch);
  }
}

// =============================================================================
// Process Record Load
// =============================================================================

/** Dependencies for handleProcessRecordLoad. */
export interface ProcessRecordLoadDeps {
  storage: StorageBackend;
  recordLoadStore: RecordLoadStore;
  /** Takes the delivery in, and runs the load's pieces. */
  runner: TaskRunner;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a long load has finished. The job is left
   * `processing`, and the call that runs it again takes up its turn, its
   * intake and its pieces where they stood: the intake remembers the pieces it
   * took in, and the execution cache answers the load's that finished.
   */
  signal?: AbortSignal;
}

/** Input for handleProcessRecordLoad. */
export interface ProcessRecordLoadInput {
  id: string;
  repo: string;
}

/** The least time between two writes of a load's pieces to its store. */
const LOAD_PIECES_INTERVAL_MS = 500;

/** How often a running load's job reads its record, to find a request to
 *  cancel it. */
export const LOAD_CANCEL_POLL_MS = 1_000;

/**
 * Processes a record load job.
 *
 * Gets the job, loads its delivery into its record's source (`recordLoad`),
 * and records what the load did, or why it did not. A client polling the job
 * reads how far it has got: each step as it happens, its pieces at most every
 * {@link LOAD_PIECES_INTERVAL_MS}, the newest count no later than that after
 * it came, and the last count of them before the step after.
 *
 * Only the job writes its end. A cancel records a request on the job's
 * record, which the job reads every {@link LOAD_CANCEL_POLL_MS} as it runs; a
 * progress write the store refuses, the job having ended, says the same. The
 * load then stops: stopped before its commit wrote, the job ends `cancelled`,
 * and its finished pieces stay cached; once its commit has written, the load
 * has landed, and the job ends `completed`, never `failed`: a store that
 * fails the write of that end is asked again until it takes it. A job asked
 * to cancel before it starts loads nothing, and ends `cancelled`.
 *
 * @param deps - Storage backend, record load store, the runner the load runs
 *   on, and the caller's signal
 * @param input - Job ID and repository identifier
 *
 * @throws Re-throws the error that stopped the load once the job is recorded
 *   `failed`, or, when `deps.signal` has aborted, with the job left
 *   `processing`; a job that ends `cancelled` returns
 */
export async function handleProcessRecordLoad(
  deps: ProcessRecordLoadDeps,
  input: ProcessRecordLoadInput,
): Promise<void> {
  const { storage, recordLoadStore, runner, signal } = deps;
  const { id, repo } = input;

  const record = await recordLoadStore.get(id);
  if (!record) throw new Error(`Record load ${id} not found`);
  if (record.status.type !== 'processing') return;

  // The job's own signal: the caller's, which hands the job over, and a
  // request to cancel it, once the job finds one
  const asked = new AbortController();
  const ask = (): void => {
    if (!asked.signal.aborted) asked.abort(new Error(`record load ${id} was asked to cancel`));
  };
  if (record.cancel.type === 'some') ask();
  const jobSignal = signal === undefined ? asked.signal : AbortSignal.any([signal, asked.signal]);
  const watch = setInterval(() => {
    recordLoadStore.get(id).then((current) => {
      if (current === null || current.cancel.type === 'some' || current.status.type !== 'processing') ask();
    }, () => {
      // A read that fails leaves the load running: the next one looks again.
    });
  }, LOAD_CANCEL_POLL_MS);

  // Progress is written one write at a time, and the last before the end
  let writes: Promise<void> = Promise.resolve();
  const write = (progress: RecordLoadProgress): void => {
    writes = writes.then(async () => {
      // Refused: the job has ended
      if (!await recordLoadStore.updateStatus(id, variant('processing', some(progress)))) ask();
    }).catch(() => {
      // A progress write that fails leaves the last one standing.
    });
  };
  // Pieces settle many times a second: the newest count is held back, and
  // written once the interval has passed, or before the step after
  const pieces = heldProgress(write, LOAD_PIECES_INTERVAL_MS);
  const report = (progress: RecordLoadProgress): void => {
    if (progress.type === 'pieces') {
      pieces.hold(progress);
      return;
    }
    pieces.flush();
    write(progress);
  };
  let result: RecordLoadResult;
  try {
    try {
      result = await recordLoad(storage, runner, repo, record.workspace, record.record, record.source, record.delivery, {
        actor: record.actor,
        ...(record.asOf.type === 'some' && { asOf: record.asOf.value }),
        signal: jobSignal,
        onProgress: report,
      });
    } finally {
      // The load has settled: no count is written after its end
      pieces.stop();
      clearInterval(watch);
      await writes;
    }
  } catch (err) {
    // Stopped before its commit wrote, at a request to cancel it
    if (err instanceof RecordLoadStoppedError && asked.signal.aborted) {
      await recordLoadStore.updateStatus(id, variant('cancelled', null));
      return;
    }
    // A load its caller stopped is handed over, not failed.
    if (signal?.aborted === true) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await recordLoadStore.updateStatus(id, variant('failed', { message }));
    throw err;
  }
  // Its commit has written, when it made one: the load has landed, whatever
  // was asked since, and whatever the store says of the write of its end
  await landedWritten(recordLoadStore, id, result, signal);
}

/**
 * Writes the end of a load that has landed: `completed`, and nothing else.
 *
 * @remarks
 * The record holds the delivery once the load's commit has written, so no
 * failure after it is the load's: a store that fails the write of the job's
 * end is asked again, each {@link LOAD_CANCEL_POLL_MS}, until it takes it. A
 * job its caller stops meanwhile is handed over as it stands, `processing`:
 * the call that runs it again is answered `again` by the record, and writes
 * its end.
 */
async function landedWritten(store: RecordLoadStore, id: string, result: RecordLoadResult, signal: AbortSignal | undefined): Promise<void> {
  for (;;) {
    try {
      await store.updateStatus(id, variant('completed', result));
      return;
    } catch (err) {
      if (signal?.aborted === true) throw err;
      await new Promise<void>((resolve) => { setTimeout(resolve, LOAD_CANCEL_POLL_MS); });
    }
  }
}
