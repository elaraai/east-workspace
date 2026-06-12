/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Persistence-free process execution helpers.
 *
 * These are the process mechanics extracted from `taskExecute`'s runCommand
 * (LocalTaskRunner.ts) so they can be shared by the tracked dataflow path
 * and the graph-free `runDetached` path. None of these functions touch the
 * storage backend — persistence (execution records, logs, output objects)
 * stays with the caller.
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import crossSpawn from 'cross-spawn';
import { spawn as nodeSpawn } from 'child_process';
import { runnerToArgv, type RunnerValue } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';

// On Windows, pnpm's workspace bins are `.cmd` / `.ps1` files, not real
// executables. Node's `spawn(name, ...)` doesn't honour PATHEXT and
// won't find `east-node.cmd` from a bare `east-node` invocation;
// blanket `shell: true` works for that case but joins args into a
// shell-parsed string, which then breaks commands like
// `bash -c 'exit 42'` (the customTask path's bash wrapper). cross-spawn
// targets exactly this gap — PATHEXT-aware resolution + correct arg
// quoting for `.cmd`/`.bat`, passthrough for real binaries on POSIX.
const spawn: typeof nodeSpawn = (process.platform === 'win32'
  ? (crossSpawn as unknown as typeof nodeSpawn)
  : nodeSpawn);

/**
 * Walk up from `startDir` and return every `node_modules/.bin` directory
 * found, ordered from nearest to furthest. Used to prepend each to a
 * spawned process's PATH so the runner CLI resolves no matter which level
 * of the monorepo a binary was hoisted to — pnpm puts shared bins at the
 * workspace root, package-local bins next to their consumer.
 */
export function collectNodeModulesBins(startDir: string): string[] {
  const bins: string[] = [];
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, 'node_modules', '.bin');
    if (existsSync(candidate)) bins.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return bins;
    dir = parent;
  }
}

/**
 * Marshal input objects to staged `.beast2` files in a scratch directory.
 *
 * This is the input-staging loop extracted from `taskExecute`: each input
 * hash is read from the object store and written as `input-<i>.beast2`.
 *
 * @returns The staged file paths, in input order
 */
export async function marshalInputsToDir(
  storage: StorageBackend,
  repo: string,
  scratchDir: string,
  inputHashes: string[]
): Promise<string[]> {
  const inputPaths: string[] = [];
  for (let i = 0; i < inputHashes.length; i++) {
    const inputPath = path.join(scratchDir, `input-${i}.beast2`);
    const inputData = await storage.objects.read(repo, inputHashes[i]!);
    await fs.writeFile(inputPath, inputData);
    inputPaths.push(inputPath);
  }
  return inputPaths;
}

/**
 * Marshal raw value bytes to staged `.beast2` files in a scratch directory.
 *
 * The graph-free path writes args to scratch directly from request bytes —
 * no object-store round trip.
 *
 * @returns The staged file paths, in arg order
 */
export async function marshalBytesToDir(
  scratchDir: string,
  blobs: Uint8Array[]
): Promise<string[]> {
  const argPaths: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const argPath = path.join(scratchDir, `input-${i}.beast2`);
    await fs.writeFile(argPath, blobs[i]!);
    argPaths.push(argPath);
  }
  return argPaths;
}

/**
 * Read a runner's output file back as bytes.
 *
 * Extracted so the graph-free path returns bytes without writing them to
 * the object store.
 */
export async function readOutputFile(outputPath: string): Promise<Uint8Array> {
  return fs.readFile(outputPath);
}

/**
 * Build the full runner argv for a function/one-shot call.
 *
 * This is the function analogue of a task's `commandIr` output — built
 * directly from the wire runner variant, no IR evaluation. (Task mapping:
 * `args` ⇄ the `-i` data inputs, `bodyIr` ⇄ the trailing IR positional
 * that was `input-0`.)
 */
export function buildRunnerArgv(
  runner: RunnerValue,
  argPaths: string[],
  outputPath: string,
  bodyIrPath: string
): string[] {
  return [
    ...runnerToArgv(runner),
    ...argPaths.flatMap((p) => ['-i', p]),
    '-o', outputPath,
    bodyIrPath,
  ];
}

/**
 * Options for {@link spawnAndCapture}.
 */
export interface SpawnAndCaptureOptions {
  /** Wall-clock limit in ms; on expiry the process group is killed and the
   *  result reports `timedOut: true`. */
  timeoutMs?: number;
  /** AbortSignal for cancellation (kills the process group). */
  signal?: AbortSignal;
  /** Streaming stdout callback (called per chunk, before tail capture). */
  onStdout?: (data: string) => void;
  /** Streaming stderr callback (called per chunk, before tail capture). */
  onStderr?: (data: string) => void;
  /** Per-stream in-memory tail cap in bytes (default 64 KiB). */
  maxLogBytes?: number;
  /** Directories whose ancestor `node_modules/.bin` dirs are prepended to
   *  PATH so runner CLIs resolve (deduped, nearest first). */
  searchDirs?: string[];
  /** Called once the child has spawned, with its pid (or null). The tracked
   *  path uses this to write the `running` execution status. */
  onSpawned?: (pid: number | null) => void | Promise<void>;
}

/**
 * Result of {@link spawnAndCapture}.
 */
export interface SpawnAndCaptureResult {
  /** Process exit code (null if killed by signal or spawn failed) */
  exitCode: number | null;
  /** Spawn-failure / non-zero-exit description (null on success) */
  error: string | null;
  /** True if the timeout fired and killed the process group */
  timedOut: boolean;
  /** Bounded tail of stdout (per maxLogBytes) */
  stdoutTail: string;
  /** Bounded tail of stderr (per maxLogBytes) */
  stderrTail: string;
  /** True if stdout bytes were dropped from the tail */
  stdoutTruncated: boolean;
  /** True if stderr bytes were dropped from the tail */
  stderrTruncated: boolean;
}

/**
 * Spawn a command and capture its output — the `runCommand` mechanics from
 * LocalTaskRunner minus every storage write.
 *
 * Keeps: cross-spawn/nodeSpawn selection, node_modules/.bin PATH
 * augmentation, `detached: true` process-group management, stdout/stderr
 * listeners (streaming callbacks + bounded in-memory tails), process-group
 * kill, timeout + AbortSignal wiring.
 *
 * Process Lifecycle Management
 * ============================
 * We use detached: true to create a new process group, allowing us to kill
 * the entire process tree by signaling the negative PID (process group
 * leader). Process groups are flat, not hierarchical — a task that calls
 * setsid() escapes the kill; that is a known, accepted limitation (see the
 * discussion that used to live in runCommand).
 */
export async function spawnAndCapture(
  args: string[],
  scratchDir: string,
  options: SpawnAndCaptureOptions = {}
): Promise<SpawnAndCaptureResult> {
  const [cmd, ...cmdArgs] = args;
  if (!cmd) {
    return {
      exitCode: null,
      error: 'Empty command',
      timedOut: false,
      stdoutTail: '',
      stderrTail: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  }

  // Collect every node_modules/.bin walking up from each search dir and
  // prepend the lot (deduped) so the spawn finds the installed runner
  // regardless of where in a monorepo the project sits — the nearest .bin
  // often lacks the runner (it's hoisted to the workspace root), so we
  // can't stop at the first hit.
  //
  // Pass env ONLY when we have something to add. Without `env`, the child
  // inherits process.env directly — exactly what we want when no augment
  // is available (the inherited PATH is the proven-working state).
  const seen = new Set<string>();
  const projectBins = (options.searchDirs ?? [])
    .flatMap((d) => collectNodeModulesBins(d))
    .filter((b) => (seen.has(b) ? false : (seen.add(b), true)));
  const spawnOpts: Parameters<typeof spawn>[2] = {
    // Run in the per-execution scratch dir, not the caller's cwd. Tasks
    // address inputs/outputs by absolute path and resolve their runner via
    // PATH, so cwd isn't part of the contract — and inheriting the
    // caller's cwd pins it. On Windows a live process's cwd can't be
    // removed, so a `detached` child that outlives a killed parent would
    // hold the repo/project dir open and block its cleanup (EBUSY).
    cwd: scratchDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  };
  if (projectBins.length > 0) {
    const pathSep = process.platform === 'win32' ? ';' : ':';
    spawnOpts.env = {
      ...process.env,
      PATH: `${projectBins.join(pathSep)}${pathSep}${process.env.PATH ?? ''}`,
    };
  }
  const child = spawn(cmd, cmdArgs, spawnOpts);

  // Set up event listeners IMMEDIATELY before any async work to avoid
  // missing events if the process completes quickly. Capture bounded tails
  // of both streams so callers get a useful diagnostic without ballooning
  // memory on chatty processes.
  const tailBytes = options.maxLogBytes ?? 64 * 1024;
  let stdoutTail = '';
  let stderrTail = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;

  const resultPromise = new Promise<{ exitCode: number | null; error: string | null }>((resolve) => {
    child.on('error', (err) => {
      resolve({ exitCode: null, error: `Failed to spawn: ${err.message}` });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ exitCode: code, error: null });
      } else {
        const tail = stderrTail.trim();
        const detail = tail ? `\nstderr:\n${tail}` : '';
        resolve({ exitCode: code, error: `Exit code: ${code}${detail}` });
      }
    });
  });

  child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString('utf-8');
    const combined = stdoutTail + str;
    if (combined.length > tailBytes) stdoutTruncated = true;
    stdoutTail = combined.slice(-tailBytes);
    if (options.onStdout) options.onStdout(str);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const str = data.toString('utf-8');
    const combined = stderrTail + str;
    if (combined.length > tailBytes) stderrTruncated = true;
    stderrTail = combined.slice(-tailBytes);
    if (options.onStderr) options.onStderr(str);
  });

  // Helper to kill the entire process group (child and all its descendants).
  // With detached: true, child.pid is the process group leader, so killing
  // -child.pid sends the signal to all processes in that group.
  const killProcessGroup = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Process may have already exited
      }
    }
  };

  // Handle timeout
  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeoutMs) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      killProcessGroup();
    }, options.timeoutMs);
  }

  // Handle abort signal
  if (options.signal) {
    if (options.signal.aborted) {
      // Already aborted before we started
      killProcessGroup();
    } else {
      options.signal.addEventListener('abort', killProcessGroup, { once: true });
    }
  }

  // Notify the caller of the spawned pid (tracked path writes its
  // `running` status here).
  if (options.onSpawned) {
    await options.onSpawned(child.pid ?? null);
  }

  // Wait for process to complete
  const result = await resultPromise;

  // Cleanup
  if (timeoutId) clearTimeout(timeoutId);
  if (options.signal) {
    options.signal.removeEventListener('abort', killProcessGroup);
  }

  return {
    exitCode: result.exitCode,
    error: result.error,
    timedOut,
    stdoutTail,
    stderrTail,
    stdoutTruncated,
    stderrTruncated,
  };
}
