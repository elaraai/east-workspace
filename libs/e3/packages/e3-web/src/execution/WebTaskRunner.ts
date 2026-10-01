/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebTaskRunner`: e3's runner in a browser, which runs every unit — a task's,
 * a piece's or a merge's, a function call's, an intake's — on a worker of a
 * {@link UnitPool}, with east's `executeUnit`.
 *
 * It does what the local runner does, through e3's shared logic: the
 * execution cache's probe, with this runner's judgement of what still runs;
 * the attempt's records, owner first, then `running` and its end; the units
 * a task runs as (`runUnitOf`, `mergeUnitOf`, `callUnitOf`, `intakeUnitOf`)
 * and where each one's output is; a split task's stages through the engine
 * (`executeSplitTask`); and its output through the store's door
 * (`storeCollection`).
 *
 * A unit's inputs are staged whole into its worker: every file it names, its
 * collections' segments with them, read from the store before it runs — the
 * runner protocol's `fetch` is false. A browser worker could wait for a
 * segment only on a `SharedArrayBuffer`, which a page has only when it is
 * cross-origin isolated. A task over a large input splits it into pieces
 * (`e3.partition`), each piece's unit staging its piece.
 *
 * Every execution it records is owned by the tab's session — the session of
 * the locks adapter it is given, which `WebStorage`'s lock holders name too —
 * as a process with pid 0 and the session's id as its boot. An execution
 * recorded `running` can still finish while its owner's session lives.
 *
 * What a browser cannot do is refused, naming it: a command — a custom task,
 * or a task on the custom runtime — is recorded `error`; a platform package
 * its unit worker does not serve, and a platform function a package does not
 * provide, fail the unit, naming them. Memory is not measured: no record
 * names a peak, and the pool, as wide as the machine's cores, is the only
 * budget.
 *
 * @packageDocumentation
 */

import {
  EastTypeValueType,
  IntegerType,
  encodeBeast2For,
  encodeBeast2SegmentsFor,
  equalFor,
  readBeast2Manifest,
  spliceBeast2,
  type Unit,
} from '@elaraai/east';
import { manifestByteSize, type ExecutionOwner, type TaskObject } from '@elaraai/e3-types';
import {
  DeliveryRefusedError,
  ExecutionAttempt,
  INTAKE_OUTPUT_FILE,
  INTAKE_TYPE_FILE,
  OBJECT_CONCURRENCY,
  UNIT_OUTPUT_DIR,
  callUnitOf,
  deliveryPiece,
  eachAtMost,
  emitsRuns,
  emittedCollectionType,
  executeSplitTask,
  inputsHash,
  intakeUnitOf,
  isSplitTask,
  mergeUnitOf,
  openDatasetObject,
  outputMergeUnitOf,
  outputRunsOf,
  probeExecutionCache,
  readTaskObject,
  runUnitOf,
  storeCollection,
  storeDatasetBytes,
  toTaskResult,
  unitOutputOf,
  uuidv7,
  type DetachedResult,
  type DetachedRunOptions,
  type DetachedSpec,
  type ExecutionIds,
  type ExecutionLiveness,
  type ExecutionResult,
  type IntakeOptions,
  type IntakeResult,
  type IntakeSpec,
  type MergeParts,
  type RunningExecution,
  type SplitUnit,
  type StorageBackend,
  type TaskExecuteOptions,
  type TaskResult,
  type TaskRunner,
  type UnitForm,
} from '@elaraai/e3-core/portable';
import type { LocksAdapter } from '../storage/adapters.js';
import type { UnitPool, UnitRun } from './pool.js';
import type { UnitFile } from './protocol.js';

/** What a browser records a command with: it runs none. */
export const NO_COMMANDS = 'a browser runs no commands';

/** The largest delivery a browser's runner takes in whole, unless its host
 *  sets one: 256 MiB, since a unit holds its delivery in memory. */
export const DEFAULT_WHOLE_INTAKE_LIMIT = 256 * 2 ** 20;

/** The runner a browser's units run on, as an intake names it. */
export const WEB_RUNNER = 'east-web';

/** The threads a browser's unit may use: it frames every output inline. */
const UNIT_THREADS = 1;

/** How much of a unit's stderr a failed execution's message carries. */
const STDERR_TAIL_BYTES = 64 * 1024;

/** The files a call's unit names: its program and its value. */
const CALL_PROGRAM = 'program.beast2';
const CALL_OUTPUT = 'output.beast2';

/** The file an intake unit's delivery is staged at. */
const DELIVERY_FILE = 'delivery.beast2';

const utf8 = new TextEncoder();
const utf8Text = new TextDecoder();
const sameInteger = equalFor(IntegerType);

/**
 * The last bytes of what a stream wrote, at most a limit of them, cut where a
 * character starts.
 */
class LogTail {
  private kept = '';
  private cut = false;

  /**
   * @param limit - The most bytes kept, in UTF-8
   */
  constructor(private readonly limit: number) {}

  /** Adds what the stream wrote next. */
  add(text: string): void {
    const combined = this.kept + text;
    // Three bytes a code unit at most: a text that short fits as it is.
    if (combined.length * 3 <= this.limit) {
      this.kept = combined;
      return;
    }
    const bytes = utf8.encode(combined);
    if (bytes.length <= this.limit) {
      this.kept = combined;
      return;
    }
    this.cut = true;
    let start = bytes.length - this.limit;
    // A UTF-8 continuation byte is 10xxxxxx: the tail starts at the next
    // character.
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
    this.kept = utf8Text.decode(bytes.subarray(start));
  }

  /** What is kept. */
  get text(): string {
    return this.kept;
  }

  /** Whether anything was cut. */
  get truncated(): boolean {
    return this.cut;
  }
}

/** The names directly in a directory of files, by their paths. */
function namesIn(files: ReadonlyMap<string, Uint8Array>, dir: string): string[] {
  const names = new Set<string>();
  for (const path of files.keys()) {
    if (path.startsWith(`${dir}/`)) names.add(path.slice(dir.length + 1).split('/')[0]!);
  }
  return [...names];
}

/** A segment of a manifest a unit wrote, from the files beside it. */
function segmentOf(files: ReadonlyMap<string, Uint8Array>, manifest: string, hash: string): Uint8Array {
  const segment = files.get(`${manifest}.segments/${hash}.beast2`);
  if (segment === undefined) throw new Error(`the unit wrote no segment ${hash} of ${manifest}`);
  return segment;
}

/**
 * Stores a file a unit wrote through the store's door: a manifest's segments
 * under the hashes that name them, and the collection as `storeCollection`
 * stores it from them, or any other value as its bytes.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param files - What the unit wrote
 * @param file - The file that holds its output
 * @returns The output's hash: the manifest's, for a collection
 * @throws {Error} When the unit wrote no such file, or a segment its manifest
 *   names, or the door refuses the collection.
 */
async function storeWritten(storage: StorageBackend, repo: string, files: ReadonlyMap<string, Uint8Array>, file: string): Promise<string> {
  const bytes = files.get(file);
  if (bytes === undefined) throw new Error(`the unit wrote no ${file}`);
  const manifest = readBeast2Manifest(bytes);
  if (manifest === null) return storeDatasetBytes(storage, repo, bytes);
  // The Writer's segments, as they stand: each is stored under the hash the
  // manifest names it by, so the door carries it by reference.
  await eachAtMost([...new Set(manifest.entries.map((entry) => entry.hash))], OBJECT_CONCURRENCY, async (hash) => {
    const stored = await storage.objects.write(repo, segmentOf(files, file, hash));
    if (stored !== hash) throw new Error(`the segment ${hash} of ${file} holds bytes whose hash is ${stored}`);
  });
  return storeCollection(storage, repo, manifest.type, [{ stored: await storage.objects.write(repo, bytes) }]);
}

/**
 * How a {@link WebTaskRunner} runs its repository's units.
 */
export interface WebTaskRunnerOptions {
  /** The repository whose tasks it runs */
  readonly repo: string;
  /** The pool its units run on, which the runners of a page's repositories
   *  share */
  readonly pool: UnitPool;
  /** The tab's session: `WebStorage`'s locks (`storage.adapters.locks`). Its
   *  session owns every execution the runner records, and its liveness judges
   *  whether one recorded `running` can still finish */
  readonly locks: LocksAdapter;
  /** The largest delivery one intake unit takes in whole, in bytes:
   *  {@link DEFAULT_WHOLE_INTAKE_LIMIT} unless set */
  readonly wholeIntakeLimit?: number;
}

/**
 * e3's {@link TaskRunner} in a browser: every unit on a worker of a pool,
 * with east's `executeUnit`.
 *
 * @remarks
 * Runtime-only options a browser has no use for are not used: `verbose`, the
 * budget's `expectedPeakBytes` and `onRequeued` (no unit is requeued), and
 * `extraEnv` (a browser's units have no environment to read). A unit waiting
 * for a worker reports `onWaiting(0)`, a wait for a core alone. An execution
 * environment is the app's: its unit workers' platform packages, so a task's
 * `environment` is not materialized.
 *
 * @example
 * ```ts
 * const storage = await openWebStorage();
 * const pool = new UnitPool({ units: () => new Worker(new URL('./unit.worker.js', import.meta.url), { type: 'module' }) });
 * const runner = new WebTaskRunner({ repo: 'default', pool, locks: storage.adapters.locks });
 * const result = await runner.execute(storage, taskHash, inputHashes);
 * ```
 */
export class WebTaskRunner implements TaskRunner {
  readonly wholeIntakeLimit: number;
  private readonly repo: string;
  private readonly pool: UnitPool;
  private readonly locks: LocksAdapter;
  /** The owner every execution it records names: the tab's session */
  private readonly owner: ExecutionOwner;
  /** Its judgement of whether an execution recorded running can finish, for
   *  the cache's probes */
  private readonly liveness: ExecutionLiveness;

  /**
   * @param options - Its repository, its pool, the tab's session, and the
   *   largest delivery it takes in whole
   * @throws {RangeError} When the whole-intake limit is not a whole number of
   *   bytes, zero or more
   */
  constructor(options: WebTaskRunnerOptions) {
    const limit = options.wholeIntakeLimit ?? DEFAULT_WHOLE_INTAKE_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError(`a runner's whole-intake limit is a whole number of bytes, zero or more, not ${limit}`);
    }
    this.wholeIntakeLimit = limit;
    this.repo = options.repo;
    this.pool = options.pool;
    this.locks = options.locks;
    this.owner = { pid: 0n, pidStartTime: 0n, bootId: options.locks.session };
    this.liveness = (storage, taskHash, inHash, running) => this.executionAlive(storage, taskHash, inHash, running);
  }

  async execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options: TaskExecuteOptions = {}): Promise<TaskResult> {
    const inHash = inputsHash(inputHashes);
    const startTime = Date.now();
    if (options.force !== true) {
      const cached = await probeExecutionCache(storage, this.repo, taskHash, inHash, this.liveness);
      if (cached !== null) return toTaskResult(cached);
    }
    const ids: ExecutionIds = { inHash, executionId: uuidv7(), startTime };
    const task = await readTaskObject(storage, this.repo, taskHash, inputHashes, ids, false);
    if (!('body' in task)) return toTaskResult(task);
    if (isSplitTask(task)) {
      // The engine's stages, each unit on the pool: the tab's session owns
      // the task's own execution, and judges what still runs.
      return toTaskResult(await executeSplitTask(storage, this.repo, taskHash, task, inputHashes, ids, {
        ...(options.force !== undefined && { force: options.force }),
        ...(options.signal !== undefined && { signal: options.signal }),
        ...(options.onPartitionProgress !== undefined && { onPartitionProgress: options.onPartitionProgress }),
      }, (unitInputs, unitIds, merge, _expectedPeakBytes, own) =>
        this.runUnit(storage, taskHash, task, unitInputs, unitIds, options, merge, !own),
      { width: this.pool.width, owner: this.owner, executionAlive: this.liveness }));
    }
    return toTaskResult(await this.runUnit(storage, taskHash, task, inputHashes, ids, options, null, false));
  }

  async executeUnit(storage: StorageBackend, taskHash: string, unit: SplitUnit, options: TaskExecuteOptions = {}): Promise<TaskResult> {
    const inHash = inputsHash(unit.inputs);
    if (options.force !== true) {
      const cached = await probeExecutionCache(storage, this.repo, taskHash, inHash, this.liveness);
      if (cached !== null) return toTaskResult(cached);
    }
    const ids: ExecutionIds = { inHash, executionId: uuidv7(), startTime: Date.now() };
    const task = await readTaskObject(storage, this.repo, taskHash, unit.inputs, ids, !unit.own);
    if (!('body' in task)) return toTaskResult(task);
    return toTaskResult(await this.runUnit(storage, taskHash, task, unit.inputs, ids, options, unit.merge, !unit.own));
  }

  /**
   * Whether an execution recorded `running` can still finish: while the
   * session its owner names lives — its Web Lock is held. An execution with no
   * owner recorded, or owned by anything but a tab's session, cannot.
   */
  async executionAlive(storage: StorageBackend, taskHash: string, inputsHash: string, running: RunningExecution): Promise<boolean> {
    const owner = await storage.refs.executionOwnerRead(this.repo, taskHash, inputsHash, running.executionId);
    if (owner === null || !sameInteger(owner.pid, 0n)) return false;
    return this.locks.isAlive(owner.bootId);
  }

  /**
   * Runs a function or one-shot call on a worker: its program and its
   * arguments staged whole, its value returned inline, and nothing durable
   * written.
   *
   * @remarks
   * Its limits hold as a local call's do: past `timeoutMs` its worker is
   * terminated, and replaced, and the call is `timed_out`; a value over
   * `maxResultBytes` is `too_large`; each log stream keeps its last
   * `maxLogBytes`. An aborted call is `failed` with exit code -1, as is a call
   * on the custom runtime, which a browser cannot run: its stderr says so.
   *
   * @throws {Error} When an argument is a stored dataset and `options` gives no
   *   `storage` to stage it from.
   */
  async runDetached(spec: DetachedSpec, options: DetachedRunOptions = {}): Promise<DetachedResult> {
    const stdout = new LogTail(spec.limits.maxLogBytes);
    const stderr = new LogTail(spec.limits.maxLogBytes);
    const streams = () => ({ stdout: stdout.text, stderr: stderr.text, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated });
    // What e3 says of a call it could not run, after what the call wrote, as
    // a local call that could not spawn says it.
    const saying = (why: string) => {
      const said = streams();
      return { ...said, stderr: said.stderr === '' ? why : `${said.stderr}\n${why}` };
    };
    const runner = spec.runner;
    if (runner.type === 'custom') return { kind: 'failed', exitCode: -1, ...saying(NO_COMMANDS) };
    // The caller keeps its bytes: the worker is given copies.
    const files = new Map<string, Uint8Array>([[CALL_PROGRAM, spec.bodyIr.slice()]]);
    const inputs: string[] = [];
    for (const [i, arg] of spec.args.entries()) {
      const at = `input-${i}.beast2`;
      if (arg instanceof Uint8Array) {
        files.set(at, arg.slice());
      } else if (options.storage === undefined) {
        throw new Error(`argument ${i + 1} is a stored dataset, which is staged from a repository: runDetached needs options.storage`);
      } else {
        await this.stageDataset(options.storage, arg.dataset, at, files);
      }
      inputs.push(at);
    }
    const unit = callUnitOf(runner, CALL_PROGRAM, inputs, CALL_OUTPUT, UNIT_THREADS, false);
    const run = await this.pool.run(unit, files, {
      ...(options.signal !== undefined && { signal: options.signal }),
      timeoutMs: spec.limits.timeoutMs,
      onLog: (stream, text) => (stream === 'stdout' ? stdout : stderr).add(text),
    });
    switch (run.kind) {
      case 'timed_out':
        return { kind: 'timed_out', ms: spec.limits.timeoutMs, ...streams() };
      case 'aborted':
        return { kind: 'failed', exitCode: -1, ...streams() };
      case 'failed':
        return { kind: 'failed', exitCode: -1, ...saying(run.message) };
      case 'done': {
        if (run.result.outcome.type === 'failed') return { kind: 'failed', exitCode: 1, ...streams() };
        const written = run.files.get(CALL_OUTPUT);
        if (written === undefined) return { kind: 'failed', exitCode: 0, ...saying('Runner exited 0 but wrote no output file') };
        const limit = spec.limits.maxResultBytes;
        if (written.length > limit) return { kind: 'too_large', bytes: written.length, limit, ...streams() };
        const manifest = readBeast2Manifest(written);
        if (manifest === null) return { kind: 'success', value: written, ...streams() };
        // A collection: its segments are standalone blobs under one header,
        // which splice into the blob they were cut from.
        const bytes = manifestByteSize(manifest);
        if (bytes > limit) return { kind: 'too_large', bytes, limit, ...streams() };
        const value = manifest.entries.length === 0
          ? encodeBeast2SegmentsFor(manifest.type)([])
          : spliceBeast2(manifest.entries.map((entry) => segmentOf(run.files, CALL_OUTPUT, entry.hash)));
        return { kind: 'success', value, ...streams() };
      }
    }
  }

  /**
   * Takes a delivery the store holds in, or a run of its segments, through an
   * intake unit on a worker, and stores what it wrote through the store's
   * door.
   *
   * @remarks
   * A run of a delivery's segments is staged as a blob of its own, read by
   * ranges ({@link deliveryPiece}), so the unit holds its piece rather than
   * the delivery; a delivery taken in whole is staged whole, which the shared
   * intake bounds by {@link wholeIntakeLimit}.
   *
   * @throws {DeliveryRefusedError} When the unit refuses the delivery.
   * @throws {Error} When the delivery is a file, which a browser's runner
   *   cannot read; when the unit's worker could not run it; or, as an
   *   `AbortError`, when the intake was aborted.
   */
  async intake(storage: StorageBackend, spec: IntakeSpec, options: IntakeOptions = {}): Promise<IntakeResult> {
    const source = spec.source;
    if (!('object' in source)) {
      throw new Error(`intake: the delivery is the file ${source.file}, which a browser's runner cannot read: a delivery a browser takes in is an object in the store`);
    }
    if (options.signal?.aborted) throw abortError();
    const files = new Map<string, Uint8Array>([[INTAKE_TYPE_FILE, encodeBeast2For(EastTypeValueType)(spec.type)]]);
    let segments = spec.segments ?? null;
    const piece = segments === null ? null : await deliveryPiece(storage, this.repo, source.object, segments);
    if (piece === null) {
      files.set(DELIVERY_FILE, await storage.objects.read(this.repo, source.object));
    } else {
      files.set(DELIVERY_FILE, await collect(piece.bytes));
      segments = piece.segments;
    }
    const stderr = new LogTail(STDERR_TAIL_BYTES);
    const run = await this.pool.run(intakeUnitOf(DELIVERY_FILE, segments, UNIT_THREADS), files, {
      ...(options.signal !== undefined && { signal: options.signal }),
      onLog: (stream, text) => {
        if (stream === 'stderr') stderr.add(text);
      },
    });
    switch (run.kind) {
      case 'aborted':
        throw abortError();
      case 'timed_out':
      case 'failed':
        throw new Error(`${WEB_RUNNER} could not run the intake unit: ${run.kind === 'failed' ? run.message : 'it timed out'}`);
      case 'done': {
        const outcome = run.result.outcome;
        if (outcome.type === 'failed') {
          const refusal = outcome.value.message;
          throw new DeliveryRefusedError(WEB_RUNNER, piece === null ? refusal : piece.inDelivery(refusal), stderr.text);
        }
        return { hash: await storeWritten(storage, this.repo, run.files, INTAKE_OUTPUT_FILE), runner: WEB_RUNNER };
      }
    }
  }

  /**
   * Runs one execution's unit — a task's own, a piece of a split task, or a
   * merge of its pieces' outputs — on a worker, and records it.
   *
   * @remarks
   * A command is recorded `error`: a browser runs none. Otherwise the unit is
   * staged — its program, the files its output kind folds with and its
   * inputs, read from the store — and recorded `running` once a worker serves
   * it, owned by the tab's session. What its console writes goes to the
   * execution's log as it writes it. A set or a dict it left in several runs
   * is merged into one by a second unit. Its end is recorded: `success` with
   * its output stored through the store's door; `failed`, exit code 1, when
   * its outcome is a failure, whose message and locations end its stderr;
   * `cancelled` when the run was aborted, which terminated its worker; or
   * `error` when e3 could not run it.
   *
   * @throws What staging a unit or recording its owner throws: an input the
   *   store no longer holds, say.
   */
  private async runUnit(
    storage: StorageBackend,
    taskHash: string,
    task: TaskObject,
    inputHashes: string[],
    ids: ExecutionIds,
    options: TaskExecuteOptions,
    merge: MergeParts | null,
    isUnit: boolean,
  ): Promise<ExecutionResult> {
    const attempt = new ExecutionAttempt(storage, this.repo, taskHash, inputHashes, ids, isUnit);
    if (task.body.type === 'command' || task.runner.type === 'custom') return attempt.recordError(NO_COMMANDS);

    // What the unit names, read from the store: the objects it names by
    // their hashes, and its inputs.
    const files = new Map<string, Uint8Array>();
    const staged = new Map<string, string>();
    const stage = async (name: string, hash: string): Promise<void> => {
      staged.set(name, hash);
      files.set(name, await storage.objects.read(this.repo, hash));
    };
    let form: UnitForm;
    if (merge === null) {
      form = await runUnitOf(task, await this.stageDatasets(storage, inputHashes, files), UNIT_THREADS, false, stage);
    } else {
      const parts = await this.stageDatasets(storage, [...(merge.range === null ? [] : [merge.range]), ...merge.parts], files);
      form = merge.range === null
        ? await mergeUnitOf(task, parts, null, UNIT_THREADS, false, stage)
        : await mergeUnitOf(task, parts.slice(1), parts[0]!, UNIT_THREADS, false, stage);
    }

    const stdout = attempt.log('stdout');
    const stderr = attempt.log('stderr');
    const tail = new LogTail(STDERR_TAIL_BYTES);
    const onLog = (stream: 'stdout' | 'stderr', text: string): void => {
      if (stream === 'stdout') {
        void stdout.push(text);
        options.onStdout?.(text);
      } else {
        void stderr.push(text);
        tail.add(text);
        options.onStderr?.(text);
      }
    };
    // Owned by the tab's session, and recorded running once a worker serves
    // the unit: an execution aborted while it waits for one never is.
    let started = false;
    const onStart = async (): Promise<void> => {
      started = true;
      const startedAt = new Date();
      await attempt.recordOwner(this.owner, startedAt);
      await attempt.recordRunning({ pid: 0n, pidStartTime: 0n, bootId: this.locks.session }, startedAt);
    };
    const signal = options.signal !== undefined ? { signal: options.signal } : {};
    let run: UnitRun;
    let runs: string[] = [];
    try {
      run = await this.pool.run(form.unit, files, {
        ...signal,
        onLog,
        onStart,
        ...(options.onWaiting !== undefined && { onWaiting: options.onWaiting }),
      });
      if (run.kind === 'done' && run.result.outcome.type === 'ok' && emitsRuns(form.unit)) {
        // A set or a dict left in several runs is merged into one, by a unit
        // over the runs beside the merge function the run unit staged.
        runs = outputRunsOf(namesIn(run.files, UNIT_OUTPUT_DIR));
        const merging = outputMergeUnitOf(form.unit, runs);
        if (merging !== null) {
          const mergeFiles: UnitFile[] = [...run.files].filter(([path]) => path.startsWith(`${UNIT_OUTPUT_DIR}/`));
          const output = form.unit.work.type === 'run' ? form.unit.work.value.output : null;
          if (output?.type === 'dict' && output.value.merge.type === 'some') {
            const name = output.value.merge.value;
            mergeFiles.push([name, await storage.objects.read(this.repo, staged.get(name)!)]);
          }
          run = await this.pool.run(merging, mergeFiles, { ...signal, onLog });
        }
      }
    } finally {
      // Every line the unit wrote is in its log before its end is recorded.
      await Promise.all([stdout.idle(), stderr.idle()]);
    }

    switch (run.kind) {
      case 'aborted':
        return attempt.recordStopped('cancelled', run.started || started
          ? 'cancelled: e3 stopped the runner because the run was aborted'
          : 'cancelled: e3 did not start the runner because the run was aborted');
      case 'failed':
        return attempt.recordError(run.message);
      case 'timed_out':
        // An execution's units are given no timeout.
        return attempt.recordError('the unit ran past a timeout it was not given');
      case 'done': {
        if (run.result.outcome.type === 'failed') {
          const said = tail.text.trim();
          return attempt.recordFailed(1, `Exit code: 1${said === '' ? '' : `\nstderr:\n${said}`}`);
        }
        let outputHash: string;
        try {
          outputHash = await this.storeOutput(storage, form.unit, runs, run.files, staged);
        } catch (err) {
          return attempt.recordError(`Failed to read output: ${String(err)}`, 0);
        }
        return attempt.recordSuccess(outputHash);
      }
    }
  }

  /**
   * Stores a finished unit's output through the store's door: the file it is
   * in, or the empty collection of a set or a dict that emitted nothing.
   */
  private async storeOutput(
    storage: StorageBackend,
    unit: Unit,
    runs: readonly string[],
    files: ReadonlyMap<string, Uint8Array>,
    staged: ReadonlyMap<string, string>,
  ): Promise<string> {
    const place = unitOutputOf(unit, runs);
    if ('file' in place) return storeWritten(storage, this.repo, files, place.file);
    const program = staged.get(place.program);
    if (program === undefined) throw new Error(`the unit's program ${place.program} was not staged`);
    return storeCollection(storage, this.repo, emittedCollectionType(await storage.objects.read(this.repo, program), place.empty), []);
  }

  /**
   * Stages datasets as a unit's inputs, `input-<i>.beast2`, in order.
   *
   * @returns Their files, as the unit names them
   */
  private async stageDatasets(storage: StorageBackend, hashes: readonly string[], files: Map<string, Uint8Array>): Promise<string[]> {
    const names: string[] = [];
    for (const [i, hash] of hashes.entries()) {
      const at = `input-${i}.beast2`;
      await this.stageDataset(storage, hash, at, files);
      names.push(at);
    }
    return names;
  }

  /**
   * Stages a stored dataset whole at a file a unit names: a collection as its
   * manifest, with every segment it names beside it
   * (`<file>.segments/<hash>.beast2`, the runner protocol's layout), and any
   * other value as its object.
   */
  private async stageDataset(storage: StorageBackend, dataset: string, at: string, files: Map<string, Uint8Array>): Promise<void> {
    const { hash, manifest } = await openDatasetObject(storage, this.repo, dataset);
    files.set(at, await storage.objects.read(this.repo, hash));
    if (manifest === null) return;
    // An Array that holds two equal segments names one object twice.
    const segments = [...new Set(manifest.entries.map((entry) => entry.hash))];
    await eachAtMost(segments, OBJECT_CONCURRENCY, async (segment) => {
      files.set(`${at}.segments/${segment}.beast2`, await storage.objects.read(this.repo, segment));
    });
  }
}

/** A source's bytes, whole. */
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** The error an aborted intake throws, as a local one does. */
function abortError(): Error {
  const error = new Error('intake: aborted');
  error.name = 'AbortError';
  return error;
}
