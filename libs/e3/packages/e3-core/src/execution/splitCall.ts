/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Split calls: a caller's program run over a dataset's pieces as a job, as e3
 * runs an index build.
 *
 * A split call is a split task whose program is the caller's. Its launch
 * writes the task object — the program as its body, on the call's runner, one
 * input per argument with the argument's partition, and the call's output kind
 * — and its job runs it with `TaskRunner.execute`, which runs a split task's
 * pieces and the merges of their outputs on the engine, each a unit cached on
 * its program and its inputs. So a relaunch is served from the cache, and a
 * call after an append reruns only the pieces whose rows changed. With `then`,
 * the job then runs that function once, detached, over the assembled output
 * and the arguments.
 *
 * What a caller may launch is one-shot's grant: `platform_free` launches only a
 * platform-free call ({@link splitCallPlatformUse}). The whole call goes
 * through `StorageBackend` and `TaskRunner`, so every backend shares it: the
 * one-shot routes of a server, and a caller with no server.
 *
 * @packageDocumentation
 */

import {
  ArrayType, BooleanType, IntegerType, OptionType, StringType, StructType, VariantType, encodeBeast2For, none, some, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  DiagnosticType, TASK_OBJECT_KIND, TaskObjectType, decodeTaskObject, manifestByteSize,
  type ExecuteResult, type PartitionProgress, type SplitCallPlan, type SplitCallProgress, type SplitCallRequest, type TaskOutputKind,
} from '@elaraai/e3-types';
import { PermissionDeniedError } from '../errors.js';
import { openDatasetObject, readDatasetWhole, readManifest } from '../dataset-open.js';
import { touchReachable } from '../gc-graph.js';
import { withRunningWork } from '../running-work.js';
import { storeDatasetBytes } from '../store-collection.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { workspaceGetPackage } from '../workspaces.js';
import type { TaskRunner } from './interfaces.js';
import {
  invalidExecuteResult, programPlatformUse, resolveJobLimits, runnerPlatformUse,
  type ExecuteCeilings, type OneShotGrant, type ResolvedLimits,
} from './oneShot.js';
import { pieceSizes, planPieces } from './pieces.js';

const encodeTaskObject = encodeBeast2For(TaskObjectType);

/**
 * What a split call's job came to, as its store keeps it: hashes, not values,
 * so a store with small records can keep it.
 *
 * - `success`: the object holding the call's value: `then`'s, or the assembled
 *   output itself
 * - `failed`: a unit or `then` failed, or e3 could not run the task
 * - `invalid`: the request is wrong, and nothing ran
 * - `too_large`: `then`'s value was over the call's `maxResultBytes`
 * - `timed_out`: the job ran past its timeout, and was stopped
 *
 * `output` is the assembled output once the pieces ran; the log tails are
 * `then`'s, or a failed task's error.
 */
export const SplitCallOutcomeType = StructType({
  outcome: VariantType({
    failed:    StructType({ exitCode: IntegerType }),
    invalid:   StructType({ diagnostics: ArrayType(DiagnosticType) }),
    success:   StructType({ value: StringType }),
    timed_out: StructType({ ms: IntegerType }),
    too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
  }),
  output: OptionType(StringType),
  stdout: StringType,
  stderr: StringType,
  stdoutTruncated: BooleanType,
  stderrTruncated: BooleanType,
});
export type SplitCallOutcome = ValueTypeOf<typeof SplitCallOutcomeType>;

/** A split call launched: the task its job runs, and what it read. */
export interface SplitCallTask {
  /** The task object's hash. */
  readonly task: string;
  /** The task's input hashes: one per argument, in argument order. */
  readonly inputs: readonly string[];
  /** The indexes of the call's `object` arguments, in argument order: what
   *  each names is re-referenced by the job before it runs
   *  ({@link splitCallReference}), never by the launch. */
  readonly objects: readonly number[];
  /** The hash of `then`'s IR bundle, or `null` when the call has none. */
  readonly then: string | null;
  /** The call's limits; its timeout is the job's. */
  readonly limits: ResolvedLimits;
  /** Each dataset argument's path and the hash it was pinned at, in argument
   *  order: what the call's result names it read. */
  readonly read: ExecuteResult['inputs'];
}

/** Options for {@link splitCallPrepare}. */
export interface SplitCallOptions {
  /** What the caller may run: the grant the host's auth gave it. */
  grant: OneShotGrant;
  /** The most a request may ask for (default: a server's): its timeout is the
   *  job's, by default and at most. */
  ceilings?: ExecuteCeilings;
}

/** Options for {@link splitCallRun}. */
export interface SplitCallRunOptions {
  /**
   * Aborted when the caller stops this run to run the job again, as compute
   * with a time limit does. The run then throws, and the next is served the
   * units that finished from the execution cache.
   */
  signal?: AbortSignal;
  /** Pass `-v` to the stock runners. */
  verbose?: boolean;
  /** Told how far the job has got as each unit starts and finishes. */
  onProgress?: (progress: SplitCallProgress) => void;
  /**
   * When the job was launched, which its timeout counts from: its record's
   * `createdAt`. A run that goes on with a job handed over gets what is left
   * of the timeout, never a fresh one. Default: now, as for a job run in one
   * call.
   */
  launchedAt?: Date;
  /** Reads the time, in epoch milliseconds, which the job's timeout is counted
   *  by. Default: `Date.now`. */
  now?: () => number;
}

/**
 * Why a split call is not platform-free, or `null` when it is.
 *
 * @remarks
 * One-shot's test ({@link oneShotPlatformUse}), over each of a split call's
 * programs: a call is platform-free when its runner is a stock runtime given no
 * platform package, and none of its body, `then`, a dict's `merge` or a fold's
 * `combine` holds a `Platform` node.
 *
 * @param request - The request
 * @returns Why it is not platform-free: its runner, or the first platform
 *   function one of its programs calls; `null` when it is platform-free
 * @throws {Error} When one of its programs does not decode as a function.
 */
export function splitCallPlatformUse(request: SplitCallRequest): string | null {
  const runner = runnerPlatformUse(request.runner);
  if (runner !== null) return runner;
  const programs: [string, Uint8Array][] = [['body', request.bodyIr]];
  if (request.then.type === 'some') programs.push(['then', request.then.value]);
  if (request.output.type === 'dict' && request.output.value.merge.type === 'some') programs.push(['merge', request.output.value.merge.value]);
  if (request.output.type === 'fold') programs.push(['combine', request.output.value.combine]);
  for (const [what, ir] of programs) {
    const use = programPlatformUse(ir, what);
    if (use !== null) return use;
  }
  return null;
}

/**
 * Whether a caller whose one-shot grant is `platform_free` may poll a split
 * call's job, which its job records at launch.
 *
 * @remarks
 * It may when the call is platform-free ({@link splitCallPlatformUse}), or
 * when a `platform_free` caller launched it, which launches no other: its own
 * call, found wrong because a program does not decode, among them. A call one
 * of whose programs does not decode, launched under `any`, is not. So a
 * reader never polls the result of a call only an elevated grant could run.
 *
 * @param request - The call
 * @param grant - The grant of the caller who launched it
 * @returns Whether a `platform_free` caller may poll its job
 */
export function splitCallPlatformFree(request: SplitCallRequest, grant: OneShotGrant): boolean {
  if (grant === 'platform_free') return true;
  try {
    return splitCallPlatformUse(request) === null;
  } catch {
    return false;
  }
}

/**
 * Launches a split call: applies the caller's grant, pins its dataset
 * arguments, and writes what its job runs.
 *
 * @remarks
 * In order:
 * 1. **Grant.** `none` is refused, and so is `platform_free` with a call that
 *    is not platform-free, before anything is read or written. A
 *    `platform_free` caller's program that does not decode is `invalid`.
 * 2. **Pin.** Each dataset argument is pinned at the hash it holds, and an
 *    `object` argument's own object must be in the store; a partitioned
 *    argument must be a stored collection. What an `object` argument names —
 *    an earlier call's output, say, a collection of thousands of segments —
 *    is the job's to re-reference before it runs ({@link splitCallReference}):
 *    the launch answers a request, and reads nothing of it but its own object.
 * 3. **Write.** The value arguments go through the store's door, so a
 *    partitioned one is a collection the pieces are cut from; the programs and
 *    a fold's zero are stored as objects.
 * 4. **Task.** The task object: the program as its body, on the call's runner,
 *    an input per argument with its partition and no path, as an index build's
 *    are, and the call's output kind.
 *
 * Nothing names what this writes until the job's executions do, so it is
 * written holding the repository's running work.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - The workspace whose datasets the call reads
 * @param request - The call
 * @param options - The caller's grant, and the ceilings its limits are held to
 * @returns What the job runs, or the `invalid` result a wrong request answers
 * @throws {PermissionDeniedError} For `none`, and for `platform_free` with a
 *   call that is not platform-free (`path` `one-shot`).
 * @throws {WorkspaceNotFoundError} When there is no such workspace
 * @throws {WorkspaceNotDeployedError} When nothing is deployed to it
 */
export async function splitCallPrepare(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  request: SplitCallRequest,
  options: SplitCallOptions,
): Promise<SplitCallTask | ExecuteResult> {
  if (options.grant === 'none') throw new PermissionDeniedError('one-shot');
  if (options.grant === 'platform_free') {
    let use: string | null;
    try {
      use = splitCallPlatformUse(request);
    } catch (err) {
      return invalidExecuteResult(`a program of the call does not decode as a function: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (use !== null) throw new PermissionDeniedError('one-shot');
  }
  if (request.runner.type === 'custom') {
    return invalidExecuteResult('a split call runs on a stock runner, east_c, east_node or east_py: not the custom runtime');
  }
  if (!request.args.some((arg) => arg.partition.type === 'some')) {
    return invalidExecuteResult('a split call partitions at least one of its arguments: its pieces are cut from it');
  }
  await workspaceGetPackage(storage, repo, workspace);

  return withRunningWork(storage, repo, async () => {
    const inputs: string[] = [];
    const objects: number[] = [];
    const read: ExecuteResult['inputs'] = [];
    for (const [i, { arg, partition }] of request.args.entries()) {
      let hash: string;
      if (arg.type === 'dataset') {
        // Objects are immutable, so a dataset pinned by its hash is a snapshot.
        const pinned = await workspaceGetDatasetHash(storage, repo, workspace, arg.value);
        if (pinned.refType !== 'value' || pinned.hash === null) {
          return invalidExecuteResult(`Dataset argument ${i} is not assigned (ref type: ${pinned.refType})`);
        }
        hash = pinned.hash;
        read.push({ path: arg.value, hash });
      } else if (arg.type === 'object') {
        if (!await storage.objects.exists(repo, arg.value)) {
          return invalidExecuteResult(`Object argument ${i} names ${arg.value}, which the repository does not hold`);
        }
        hash = arg.value;
        objects.push(i);
      } else {
        hash = await storeDatasetBytes(storage, repo, arg.value);
      }
      if (partition.type === 'some' && await readManifest(storage, repo, hash) === null) {
        return invalidExecuteResult(`Argument ${i} is partitioned, and it is not a collection: its pieces are cut from an Array, a Set or a Dict`);
      }
      inputs.push(hash);
    }

    const program = await storage.objects.write(repo, request.bodyIr);
    const then = request.then.type === 'some' ? await storage.objects.write(repo, request.then.value) : null;
    let kind: TaskOutputKind;
    switch (request.output.type) {
      case 'array':
        kind = variant('array', null);
        break;
      case 'set':
        kind = variant('set', null);
        break;
      case 'dict': {
        const merge = request.output.value.merge;
        kind = variant('dict', { merge: merge.type === 'some' ? some(await storage.objects.write(repo, merge.value)) : none });
        break;
      }
      case 'fold':
        kind = variant('fold', {
          zero: await storeDatasetBytes(storage, repo, request.output.value.zero),
          combine: await storage.objects.write(repo, request.output.value.combine),
        });
        break;
    }
    const task = await storage.objects.write(repo, encodeTaskObject({
      kind: TASK_OBJECT_KIND,
      body: variant('east', { program }),
      runner: request.runner,
      inputs: request.args.map(({ partition }) => ({ path: [], partition })),
      output: { path: [], kind },
      role: variant('data', null),
      environment: none,
    }));
    return { task, inputs, objects, then, limits: resolveJobLimits(request.limits, options.ceilings), read };
  });
}

/**
 * Re-references what a launched split call's `object` arguments name, before
 * its job reads it.
 *
 * @remarks
 * An `object` argument may have been unreachable for a while — an earlier
 * call's output, say — and its launch checks only that its own object is in
 * the store: what it names may be a collection of thousands of segments, more
 * than a request has time to walk. So the job re-references each argument
 * with everything it names (`touchReachable`), and gc beside running work
 * leaves them while the job reads them. A job holds the repository's running
 * work, and answers no request.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param call - What the launch wrote
 * @returns The `invalid` outcome that names the first argument the store no
 *   longer holds whole, or `null` when it holds every one
 * @throws {GcReadError} When an object cannot be read for a reason other than
 *   its absence, or names other objects and does not decode.
 */
export async function splitCallReference(storage: StorageBackend, repo: string, call: SplitCallTask): Promise<SplitCallOutcome | null> {
  for (const i of call.objects) {
    const hash = call.inputs[i]!;
    if (!await touchReachable(storage, repo, [hash])) {
      return splitCallInvalid(invalidExecuteResult(`Object argument ${i} names ${hash}, which the repository does not hold whole`));
    }
  }
  return null;
}

/**
 * What a launched split call's pieces are, with no unit run: an explain's job.
 *
 * @remarks
 * The pieces are planned as the call's run plans them (`planPieces`), so the
 * count is the run's, and the pieces it stores are the ones the run takes up.
 * Planning stores every piece's manifest, and re-cuts the segment at each
 * boundary a `by` or an argument partitioned with another moves, so it is a
 * job's work, never a request's: the request launches the call
 * ({@link splitCallPrepare}), and its job plans it, once it has re-referenced
 * what the call's `object` arguments name ({@link splitCallReference}).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param call - What the launch wrote
 * @returns The piece count, the argument they are cut over and what it weighs
 * @throws {Error} When the pieces cannot be planned: arguments partitioned
 *   together that are not cut by keys of the same types, say.
 */
export async function splitCallExplain(
  storage: StorageBackend,
  repo: string,
  call: SplitCallTask,
): Promise<SplitCallPlan> {
  const task = decodeTaskObject(await storage.objects.read(repo, call.task));
  const plan = await withRunningWork(storage, repo, () => planPieces(storage, repo, task.inputs, [...call.inputs], pieceSizes()));
  return { pieces: BigInt(plan.pieces.length), over: BigInt(plan.primary), bytes: BigInt(plan.primaryBytes) };
}

/** A unit's progress, as a job reports it. */
function progressOf(progress: PartitionProgress): SplitCallProgress {
  const phase = progress.phase === 'partition' ? variant('partition', null)
    : progress.phase === 'merge' ? variant('merge', null)
    : variant('combine', null);
  return { phase, done: BigInt(progress.completed), units: BigInt(progress.total) };
}

/** The last `limit` bytes of a text, and whether it was cut. */
function tail(text: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf-8');
  if (bytes.length <= limit) return { text, truncated: false };
  return { text: bytes.subarray(bytes.length - limit).toString('utf-8'), truncated: true };
}

/**
 * Runs a split call's job: the task over its pieces, and then `then`.
 *
 * @remarks
 * The task runs with `TaskRunner.execute`, as an index build's does: the
 * engine's pieces and merges, each a unit on the runner, under the budget, and
 * served from the execution cache when it ran before. With `then`, the
 * function then runs once, detached, over the assembled output and the
 * arguments, and the value it returns is stored through the store's door.
 *
 * Before any unit runs, the job re-references what the call's `object`
 * arguments name ({@link splitCallReference}): an argument the store no longer
 * holds whole ends the call `invalid`, naming it, and nothing runs.
 *
 * The job's timeout is the call's, one budget for the whole job counted from
 * its launch (`options.launchedAt`), however many runs it takes: a run that
 * goes on with a job handed over gets what is left of it, and one that starts
 * with nothing left ends `timed_out` without running a unit. Once it passes,
 * the run is stopped and the call ends `timed_out`.
 *
 * @param storage - Storage backend
 * @param runner - The repository's task runner
 * @param repo - Repository identifier
 * @param call - What the launch wrote
 * @param options - The caller's signal, verbosity and progress, when the job
 *   was launched, and the clock its timeout is counted by
 * @returns What the job came to
 * @throws The signal's reason when `options.signal` stopped the run, which is
 *   the next run's to go on with.
 */
export async function splitCallRun(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  call: SplitCallTask,
  options: SplitCallRunOptions = {},
): Promise<SplitCallOutcome> {
  const now = options.now ?? Date.now;
  const launched = options.launchedAt?.getTime() ?? now();
  /** What is left of the job's timeout. */
  const left = (): number => call.limits.timeoutMs - (now() - launched);
  const quiet = { stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
  const timedOut = (output: string | null): SplitCallOutcome => ({
    outcome: variant('timed_out', { ms: BigInt(call.limits.timeoutMs) }),
    output: output === null ? none : some(output),
    ...quiet,
  });
  if (left() <= 0) return timedOut(null);
  const unheld = await splitCallReference(storage, repo, call);
  if (unheld !== null) return unheld;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), left());
  const signal = options.signal === undefined ? deadline.signal : AbortSignal.any([options.signal, deadline.signal]);
  try {
    const result = await runner.execute(storage, call.task, [...call.inputs], {
      signal,
      ...(options.verbose !== undefined && { verbose: options.verbose }),
      ...(options.onProgress !== undefined && { onPartitionProgress: (progress: PartitionProgress) => options.onProgress!(progressOf(progress)) }),
    });
    options.signal?.throwIfAborted();
    if (result.state !== 'success' || result.outputHash === undefined) {
      if (deadline.signal.aborted) return timedOut(null);
      const stderr = tail(result.error ?? '', call.limits.maxLogBytes);
      return {
        outcome: variant('failed', { exitCode: BigInt(result.exitCode ?? -1) }),
        output: none,
        stdout: '',
        stderr: stderr.text,
        stdoutTruncated: false,
        stderrTruncated: stderr.truncated,
      };
    }
    const output = result.outputHash;
    if (call.then === null) return { outcome: variant('success', { value: output }), output: some(output), ...quiet };

    const remaining = left();
    if (remaining <= 0) return timedOut(output);
    const task = decodeTaskObject(await storage.objects.read(repo, call.task));
    const detached = await runner.runDetached({
      bodyIr: await storage.objects.read(repo, call.then),
      // The assembled output, then the arguments, each by the object it is.
      args: [output, ...call.inputs].map((dataset) => ({ dataset })),
      runner: task.runner,
      limits: { ...call.limits, timeoutMs: remaining },
    }, {
      storage,
      signal,
      ...(options.verbose !== undefined && { verbose: options.verbose }),
    });
    options.signal?.throwIfAborted();
    const streams = {
      stdout: detached.stdout,
      stderr: detached.stderr,
      stdoutTruncated: detached.stdoutTruncated,
      stderrTruncated: detached.stderrTruncated,
    };
    switch (detached.kind) {
      case 'success':
        return { outcome: variant('success', { value: await storeDatasetBytes(storage, repo, detached.value) }), output: some(output), ...streams };
      case 'failed':
        // Stopped at the deadline, a detached run answers failed.
        if (deadline.signal.aborted) return { ...timedOut(output), ...streams };
        return { outcome: variant('failed', { exitCode: BigInt(detached.exitCode) }), output: some(output), ...streams };
      case 'too_large':
        return { outcome: variant('too_large', { bytes: BigInt(detached.bytes), limit: BigInt(detached.limit) }), output: some(output), ...streams };
      case 'timed_out':
        return { ...timedOut(output), ...streams };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A split call's result, as a poll answers it: the value read from the store,
 * spliced when it is a collection, up to `maxResultBytes`.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param outcome - What the job came to
 * @param read - What the call read, which the result names
 * @param maxResultBytes - The largest value answered inline; over it the result
 *   is `too_large`, and the caller reads the output by its hash
 * @returns The call's result
 */
export async function splitCallResult(
  storage: StorageBackend,
  repo: string,
  outcome: SplitCallOutcome,
  read: ExecuteResult['inputs'],
  maxResultBytes: number,
): Promise<ExecuteResult> {
  const streams = {
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    stdoutTruncated: outcome.stdoutTruncated,
    stderrTruncated: outcome.stderrTruncated,
    inputs: read,
  };
  const ended = outcome.outcome;
  switch (ended.type) {
    case 'success': {
      const opened = await openDatasetObject(storage, repo, ended.value.value);
      const bytes = opened.manifest === null ? (await storage.objects.stat(repo, opened.hash)).size : manifestByteSize(opened.manifest);
      if (bytes > maxResultBytes) {
        return { outcome: variant('too_large', { bytes: BigInt(bytes), limit: BigInt(maxResultBytes) }), ...streams };
      }
      return { outcome: variant('success', { value: await readDatasetWhole(storage, repo, ended.value.value) }), ...streams };
    }
    case 'invalid':
      return { outcome: variant('invalid', ended.value), ...streams, inputs: [] };
    case 'failed':
      return { outcome: variant('failed', ended.value), ...streams };
    case 'too_large':
      return { outcome: variant('too_large', ended.value), ...streams };
    case 'timed_out':
      return { outcome: variant('timed_out', ended.value), ...streams };
  }
}

/**
 * The outcome a launch that found the request wrong files: `invalid`, and
 * nothing ran.
 *
 * @param result - The `invalid` result {@link splitCallPrepare} answered
 * @returns The job's outcome
 */
export function splitCallInvalid(result: ExecuteResult): SplitCallOutcome {
  const diagnostics = result.outcome.type === 'invalid' ? result.outcome.value.diagnostics : [];
  return {
    outcome: variant('invalid', { diagnostics }),
    output: none,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
}
