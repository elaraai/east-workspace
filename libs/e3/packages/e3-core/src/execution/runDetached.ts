/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Graph-free, persistence-free execution — the shared primitive behind
 * `e3.function` calls and one-shot execution.
 *
 * runDetached: marshal inputs → run a body IR on a chosen runner → return
 * the result value inline; write nothing durable. No task object, no output
 * object, no execution record, no logs, no dataset ref. The only disk write
 * is the transient scratch directory, removed on completion.
 */

import type { StorageBackend } from '../storage/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import type { RunnerValue } from '@elaraai/e3-types';
import {
  marshalBytesToDir,
  buildRunnerArgv,
  spawnAndCapture,
  readOutputFile,
} from './processExec.js';

/**
 * Specification of a detached run.
 */
export interface DetachedSpec {
  /** function: from FunctionObject; one-shot: from request */
  bodyIr: Uint8Array;
  /** positional arg values (beast2), already validated for arity */
  args: Uint8Array[];
  /** wire runner variant — resolved to argv via buildRunnerArgv */
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
 * - `success`: the runner's output file bytes (beast2), under the size cap
 * - `failed`: the process exited non-zero (or failed to spawn)
 * - `too_large`: output over `maxResultBytes` — the bytes are never loaded
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
  /** Storage backend for materializing `spec.environment` (local runner);
   *  required when the spec declares an environment. */
  storage?: StorageBackend;
}

/**
 * Run a body IR on a runner, returning the result inline.
 *
 * mkScratch → write bodyIr → marshal args → build argv → spawnAndCapture
 * (bounded-tail stdout/stderr) → on exit 0: fs.stat the output BEFORE
 * reading; size > maxResultBytes ⇒ too_large (bytes never loaded); else
 * success(readOutputFile) → finally rm scratch.
 *
 * NEVER writes to the object store, execution records, or logs.
 */
export async function runDetached(
  spec: DetachedSpec,
  options: DetachedRunOptions = {}
): Promise<DetachedResult> {
  const scratchDir = path.join(
    tmpdir(),
    `e3-call-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
  );
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    const bodyIrPath = path.join(scratchDir, 'fn.beast2');
    await fs.writeFile(bodyIrPath, spec.bodyIr);

    const argPaths = await marshalBytesToDir(scratchDir, spec.args);
    const outputPath = path.join(scratchDir, 'output.beast2');
    const args = buildRunnerArgv(spec.runner, argPaths, outputPath, bodyIrPath);

    const searchDirs = options.runnerSearchDir
      ? [options.runnerSearchDir, process.cwd()]
      : [process.cwd()];

    const result = await spawnAndCapture(args, scratchDir, {
      timeoutMs: spec.limits.timeoutMs,
      signal: options.signal,
      maxLogBytes: spec.limits.maxLogBytes,
      searchDirs,
      extraBins: options.extraBins,
    });

    const streams = {
      stdout: result.stdoutTail,
      stderr: result.stderrTail,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };

    if (result.timedOut) {
      return { kind: 'timed_out', ms: spec.limits.timeoutMs, ...streams };
    }

    if (result.exitCode !== 0) {
      // Spawn failures (exitCode null) also land here; surface the error
      // text on stderr so the caller sees why nothing ran.
      if (result.exitCode === null && result.error) {
        streams.stderr = streams.stderr ? `${streams.stderr}\n${result.error}` : result.error;
      }
      return { kind: 'failed', exitCode: result.exitCode ?? -1, ...streams };
    }

    // stat BEFORE read — an over-cap result is never loaded into memory.
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

    const value = await readOutputFile(outputPath);
    return { kind: 'success', value, ...streams };
  } finally {
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
