/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Graph-free, persistence-free execution — the shared primitive behind
 * `e3.function` calls and one-shot execution.
 *
 * runDetached: stage the program and its arguments → run them on a runner →
 * return the result value inline; write nothing durable. No task object, no
 * output object, no execution record, no logs, no dataset ref. The only disk
 * write is the transient scratch directory, removed on completion: inside the
 * repository for a local runner, as an execution's is, or the OS temp
 * directory without one. An argument is a value, or a stored dataset, which is
 * staged as a task input is and never read here.
 *
 * A stock runner runs the call as a unit through its `exec` (units.ts); a
 * `custom` runner runs its command with `run`'s arguments, as a custom task's
 * program runs.
 */

import type { StorageBackend } from '../storage/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { encodeBeast2SegmentsFor, readBeast2Manifest, spliceBeast2 } from '@elaraai/east';
import { manifestByteSize, type RunnerValue } from '@elaraai/e3-types';
import { spawnAndCapture, stageInput, type SpawnAndCaptureResult } from './processExec.js';
import { callScratchDir } from './scratch.js';
import { stageCallUnit, unitArgv } from './units.js';
import { unitThreads, type Budget, type ReleaseSlot } from './budget.js';
import { uuidv7 } from '../uuid.js';

/**
 * An argument of a detached run: a value's beast2 bytes, or a stored dataset,
 * by the hash of the object its ref names.
 */
export type DetachedArg = Uint8Array | { readonly dataset: string };

/**
 * Specification of a detached run.
 */
export interface DetachedSpec {
  /** function: from FunctionObject; one-shot: from request */
  bodyIr: Uint8Array;
  /** Positional arguments, already validated for arity. A stored dataset is
   *  staged as a task input is — a collection as its manifest with the
   *  segments linked, which a stock runner opens lazily, or spliced into one
   *  file for a custom command — so a large one never passes through this
   *  process. */
  args: DetachedArg[];
  /** wire runner variant: a stock runner runs the call as a unit, a custom
   *  one its command */
  runner: RunnerValue;
  /** execution limits (all required — the caller applies defaults/clamps) */
  limits: { timeoutMs: number; maxResultBytes: number; maxLogBytes: number };
  /** environment spec object hash (FunctionObject.environment); the runner
   *  materializes it and prepends its bin dir to the child PATH */
  environment?: string;
}

/**
 * Result of a detached run.
 *
 * - `success`: the value's beast2 bytes, under the size cap — the runner's
 *   output file, or a collection's segments spliced into one blob
 * - `failed`: the process exited non-zero (or failed to spawn)
 * - `too_large`: the output over `maxResultBytes` — its file's size, or a
 *   collection's segments' — and the value never loaded
 * - `timed_out`: the process group was killed at `timeoutMs`
 */
export type DetachedResult =
  | { kind: 'success';   value: Uint8Array; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'failed';    exitCode: number;  stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'too_large'; bytes: number; limit: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'timed_out'; ms: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean };

/**
 * Options for {@link runDetached}.
 */
export interface DetachedRunOptions {
  /** AbortSignal for cancellation (kills the process group). */
  signal?: AbortSignal;
  /** Anchor directory for the runner-binary PATH walk (replaces the task
   *  path's "walk up from repo dir" — one-shot has no repo path). The
   *  process cwd is always searched as well. */
  runnerSearchDir?: string;
  /** Executable dirs prepended to the child PATH (a materialized
   *  environment's bin dir). */
  extraBins?: string[];
  /** Storage backend for materializing `spec.environment` and staging a
   *  stored dataset argument (local runner); required when the spec declares
   *  an environment or has a dataset argument. */
  storage?: StorageBackend;
  /** The repository a local runner runs the call for. The call runs in a
   *  scratch directory under its scratch root, as an execution does, so a
   *  dataset argument's segments are linked rather than copied; required,
   *  with `storage`, when the spec has a dataset argument. Without it the
   *  call runs in the OS temp directory. */
  repo?: string;
  /** Pass `-v` to a stock runner's `exec`, so it prints where the time went
   *  and its peak memory to stderr. */
  verbose?: boolean;
}

/**
 * Run a function on a runner, returning its value inline.
 *
 * The program and arguments are staged in a scratch directory — a value
 * written, a stored dataset staged as a task input is — and the runner
 * spawned, with bounded tails of stdout and stderr. On exit 0 the output is
 * sized before it is read, so a value over `maxResultBytes` is `too_large`
 * and never loaded. A collection, which `exec` writes as a manifest naming its
 * segments, is spliced back into one blob. The scratch directory is removed
 * however the call ends.
 *
 * NEVER writes to the object store, execution records, or logs.
 *
 * @param spec - The program, its arguments, the runner and the limits
 * @param options - Cancellation, the runner's search path and verbosity
 * @param budget - The budget of the local runner that runs the call: the
 *   runner spawns only once it holds a core, and its unit is granted threads
 *   from it. Absent, the spawn is not budgeted, and the unit is granted the
 *   CPUs this process may use, up to four.
 * @returns The call's value inline, or how it failed
 * @throws {Error} When an argument is a stored dataset and `options` gives no
 *   `storage` and `repo` to stage it from.
 */
export async function runDetached(
  spec: DetachedSpec,
  options: DetachedRunOptions = {},
  budget?: Budget
): Promise<DetachedResult> {
  const scratchDir = options.repo !== undefined
    ? await callScratchDir(options.repo, uuidv7().replaceAll('-', ''))
    : path.join(tmpdir(), `e3-call-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    // A stock runner runs the call as a unit, and exits with this process: the
    // stdin lifeline pipe below and `--exit-with-parent` on its command line.
    // A custom command is given `run`'s arguments, and left alone.
    const runner = spec.runner;
    const stock = runner.type !== 'custom';
    const program = path.join(scratchDir, 'program.beast2');
    await fs.writeFile(program, spec.bodyIr);
    const inputs: string[] = [];
    for (const [i, arg] of spec.args.entries()) {
      const input = path.join(scratchDir, `input-${i}.beast2`);
      if (arg instanceof Uint8Array) {
        await fs.writeFile(input, arg);
      } else if (options.storage === undefined || options.repo === undefined) {
        throw new Error(`argument ${i + 1} is a stored dataset, which is staged from a repository: runDetached needs options.storage and options.repo`);
      } else {
        // As a task input: a stock runner opens a manifest and reads only the
        // segments it touches, and a command gets its own copy of one file.
        await stageInput(options.storage, options.repo, arg.dataset, input, { link: stock, manifests: stock });
      }
      inputs.push(input);
    }
    const outputPath = path.join(scratchDir, 'output.beast2');
    const args = runner.type === 'custom'
      ? [...runner.value.command, ...inputs.flatMap((input) => ['-i', input]), '-o', outputPath, program]
      : unitArgv(runner, await stageCallUnit(scratchDir, runner, program, inputs, outputPath, unitThreads(budget)), options.verbose);

    const searchDirs = options.runnerSearchDir
      ? [options.runnerSearchDir, process.cwd()]
      : [process.cwd()];

    // A call aborted while it waits for the budget never spawns, and ends as
    // an aborted run does.
    let release: ReleaseSlot | undefined;
    try {
      release = await budget?.acquire({ signal: options.signal });
    } catch (err) {
      if (options.signal?.aborted) {
        return { kind: 'failed', exitCode: -1, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
      }
      throw err;
    }
    let result: SpawnAndCaptureResult;
    try {
      result = await spawnAndCapture(args, scratchDir, {
        timeoutMs: spec.limits.timeoutMs,
        signal: options.signal,
        maxLogBytes: spec.limits.maxLogBytes,
        searchDirs,
        extraBins: options.extraBins,
        stdinLifeline: stock,
      });
    } finally {
      release?.();
    }

    const streams = {
      stdout: result.stdoutTail,
      stderr: result.stderrTail,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };

    if (result.timedOut) {
      return { kind: 'timed_out', ms: spec.limits.timeoutMs, ...streams };
    }

    // Stopped because the call was aborted: failed with exit code -1 however
    // the stop ended the runner — Node's kill leaves a signal, taskkill (on
    // Windows without the job launcher) exit code 1.
    if (result.stoppedByE3) {
      return { kind: 'failed', exitCode: -1, ...streams };
    }

    if (result.exitCode !== 0) {
      // Spawn failures (exitCode null) also land here; surface the error
      // text on stderr so the caller sees why nothing ran.
      if (result.exitCode === null && result.error) {
        streams.stderr = streams.stderr ? `${streams.stderr}\n${result.error}` : result.error;
      }
      return { kind: 'failed', exitCode: result.exitCode ?? -1, ...streams };
    }

    // Sized BEFORE it is read — an over-cap value is never loaded into memory.
    let size: number;
    try {
      size = (await fs.stat(outputPath)).size;
    } catch {
      streams.stderr = streams.stderr
        ? `${streams.stderr}\nRunner exited 0 but wrote no output file`
        : 'Runner exited 0 but wrote no output file';
      return { kind: 'failed', exitCode: 0, ...streams };
    }
    if (size > spec.limits.maxResultBytes) {
      return { kind: 'too_large', bytes: size, limit: spec.limits.maxResultBytes, ...streams };
    }
    const written = await fs.readFile(outputPath);
    const manifest = readBeast2Manifest(written);
    if (manifest === null) {
      return { kind: 'success', value: written, ...streams };
    }
    // A collection: the manifest records its segments' sizes, and its segments
    // are standalone blobs under one header, which splice into the blob they
    // were cut from. An empty one names no segment.
    const bytes = manifestByteSize(manifest);
    if (bytes > spec.limits.maxResultBytes) {
      return { kind: 'too_large', bytes, limit: spec.limits.maxResultBytes, ...streams };
    }
    const segments = `${outputPath}.segments`;
    const value = manifest.entries.length === 0
      ? encodeBeast2SegmentsFor(manifest.type)([])
      : spliceBeast2(await Promise.all(manifest.entries.map((entry) => fs.readFile(path.join(segments, `${entry.hash}.beast2`)))));
    return { kind: 'success', value, ...streams };
  } finally {
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
