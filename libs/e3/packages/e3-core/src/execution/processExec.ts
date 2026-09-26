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
import { StringDecoder } from 'string_decoder';
import type { Readable } from 'stream';
import crossSpawn from 'cross-spawn';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { createRequire } from 'module';
import { DatasetSegments, openDatasetObject } from '../dataset-open.js';
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
 * Walk up from `startDir` and return the first uv virtualenv bin directory
 * found — `.venv/bin` on POSIX, `.venv/Scripts` on Windows — as a one-element
 * array, or `[]` if there is no `.venv` above `startDir`.
 *
 * Unlike {@link collectNodeModulesBins} this STOPS at the first `.venv`: a uv
 * project has exactly one, so once we find it there is nothing further up to
 * collect. Used to prepend the project venv's bin dir to a spawned runner's
 * PATH so a Python runner installed there (`east-py`) resolves from the
 * project's own environment rather than a `node_modules/.bin` shim or a global
 * install. Local-host only — the path is injected into the child's PATH, never
 * into the hashed command argv.
 */
export function collectVenvBins(startDir: string): string[] {
  const subdir = process.platform === 'win32' ? 'Scripts' : 'bin';
  let dir = path.resolve(startDir);
  while (true) {
    const venv = path.join(dir, '.venv');
    if (existsSync(venv)) {
      const candidate = path.join(venv, subdir);
      return existsSync(candidate) ? [candidate] : [];
    }
    const parent = path.dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
}

/** Options for {@link marshalInputsToDir}. */
export interface MarshalInputsOptions {
  /**
   * Whether the runner opens a collection staged as a segment manifest.
   *
   * @remarks
   * True stages a manifest-backed input as the manifest file plus one linked
   * file per segment, so staging a 2 GB input is O(segments) links and no
   * bytes and the body reads only the segments it touches. Every stock runner
   * opens manifests. False splices the segments into one file, which a command
   * needs — a `customTask`'s, or the `custom` runtime's — since it reads one
   * ordinary file.
   */
  manifests?: boolean;
  /**
   * Whether a staged input may SHARE the object's storage (a hard link or a
   * reflink) rather than being copied.
   *
   * @remarks
   * True is the default and is safe for every stock runner: east-c maps its
   * inputs read-only, east-node and east-py read them. It must be false for a
   * command, which is arbitrary and could `mv` or truncate an input path —
   * which, through a hard link, would corrupt the object itself.
   */
  link?: boolean;
}

/**
 * Stages one stored dataset at `inputPath`, for a runner to read.
 *
 * @remarks
 * The bytes never pass through this process's heap: the backend places each
 * object (`ObjectStore.materialize`), a backend whose objects are files by a
 * link or one kernel copy. Before #767 an input was read whole — measured at
 * 2.1 GB of orchestrator RSS on every execution over a 2 GB input, for bytes
 * the runner then opened lazily anyway.
 *
 * A dataset stored as a segment manifest is staged as the manifest plus one
 * linked file per segment for a runner that opens the layout, and spliced
 * into one file for a runner that does not. Peak memory is one segment
 * either way; for the first, no segment's bytes move at all. An indexed
 * record's `$record` state is never staged: its primary is, the rows.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param dataset - The hash of the object the dataset's ref names
 * @param inputPath - Where the input is staged
 * @param options - Whether it may share the object's storage, and whether the
 *   runner opens a manifest
 */
export async function stageInput(
  storage: StorageBackend,
  repo: string,
  dataset: string,
  inputPath: string,
  options: MarshalInputsOptions = {}
): Promise<void> {
  const link = options.link !== false;
  const { hash, manifest } = await openDatasetObject(storage, repo, dataset);
  if (manifest !== null && options.manifests === true) {
    // The manifest itself, then its segments as sibling files named by
    // hash — the convention every runtime's opener reads. Each segment is a
    // link (or one kernel copy), so the bytes never move.
    await storage.objects.materialize(repo, hash, inputPath, { link });
    const segmentDir = `${inputPath}.segments`;
    await fs.mkdir(segmentDir, { recursive: true });
    for (const entry of manifest.entries) {
      await storage.objects.materialize(repo, entry.hash, path.join(segmentDir, `${entry.hash}.beast2`), { link });
    }
  } else if (manifest !== null) {
    // A runner that does not open manifests gets the value: the segments
    // splice back under their shared header, one chunk at a time.
    const segments = await DatasetSegments.open(storage, repo, hash);
    const handle = await fs.open(inputPath, 'w');
    try {
      for await (const chunk of segments.splice()) await handle.write(chunk);
    } finally {
      await handle.close();
    }
  } else {
    await storage.objects.materialize(repo, hash, inputPath, { link });
  }
}

/**
 * Marshal input objects to staged `.beast2` files in a scratch directory, each
 * as {@link stageInput} stages it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param scratchDir - The execution's scratch directory
 * @param inputHashes - Object hashes, in input order
 * @param options - Whether a staged input may share the object's storage
 * @returns The staged file paths, in input order
 */
export async function marshalInputsToDir(
  storage: StorageBackend,
  repo: string,
  scratchDir: string,
  inputHashes: string[],
  options: MarshalInputsOptions = {}
): Promise<string[]> {
  const inputPaths: string[] = [];
  for (let i = 0; i < inputHashes.length; i++) {
    const inputPath = path.join(scratchDir, `input-${i}.beast2`);
    await stageInput(storage, repo, inputHashes[i]!, inputPath, options);
    inputPaths.push(inputPath);
  }
  return inputPaths;
}

/** How long a child e3 stopped is read after it has exited, before its pipes
 *  are closed from this side (see spawnAndCapture). */
const STOP_DRAIN_MS = 5_000;

/** The per-platform package carrying the Windows job launcher. */
const JOB_LAUNCHER_PACKAGE = '@elaraai/e3-job-win32-x64';

let jobLauncherPath: string | null | undefined;

/**
 * The Windows job launcher, `e3-job.exe`: the path of the one this install
 * carries, or null — off Windows, and on a Windows install without it.
 *
 * @remarks
 * Windows has no process group a signal can address. Its container for "a
 * process and everything it starts" is the Job Object, which Node cannot
 * create, so e3 runs each runner in one through this small native launcher
 * (libs/e3/native/e3-job): it joins a new job that allows no breakaway and
 * ends every member when its last handle closes, starts the runner in it, and
 * exits with the runner's exit code; e3 stops the runner by ending the
 * launcher. It ships in its own per-platform package, an optional dependency
 * of e3-core; an install without it (optional dependencies omitted, or a
 * platform it is not built for) runs runners directly, and a stop ends only
 * what `taskkill /T` can find.
 *
 * @returns The launcher's path, or null
 * @internal
 */
export function jobLauncher(): string | null {
  if (jobLauncherPath === undefined) {
    jobLauncherPath = null;
    if (process.platform === 'win32') {
      try {
        jobLauncherPath = createRequire(import.meta.url).resolve(`${JOB_LAUNCHER_PACKAGE}/e3-job.exe`);
      } catch {
        process.emitWarning(
          `the Windows job launcher (${JOB_LAUNCHER_PACKAGE}) is not installed: runners run without a job object, ` +
          'and stopping one ends only the processes taskkill /T can find — install e3-core with its optional dependencies',
          { code: 'E3_NO_JOB_LAUNCHER' },
        );
      }
    }
  }
  return jobLauncherPath;
}

/**
 * Quotes one argument into a Windows command line exactly as libuv does
 * (`quote_cmd_arg`, src/win/process.c), so a command line built here is the
 * one Node would have built to spawn the same argv.
 *
 * @param arg - The argument
 * @returns The argument, quoted and escaped where it needs to be
 * @internal
 */
export function quoteWindowsArgument(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return `"${arg}"`;
  // Walking backwards a UTF-16 unit at a time, as libuv does, backslashes
  // before a quote — or before the closing quote at the end — are doubled,
  // and each quote is escaped.
  const units: string[] = [];
  let quoteFollows = true;
  for (let i = arg.length - 1; i >= 0; i--) {
    const c = arg[i]!;
    units.push(c);
    if (quoteFollows && c === '\\') {
      units.push('\\');
    } else if (c === '"') {
      quoteFollows = true;
      units.push('\\');
    } else {
      quoteFollows = false;
    }
  }
  return `"${units.reverse().join('')}"`;
}

/** A command as cross-spawn would spawn it. */
interface ParsedCommand {
  command: string;
  args: string[];
  options: SpawnOptions;
  /** The resolved path of the program, when it was found. */
  file?: string;
}

/** cross-spawn's parse of a command (`_parse`), which execa relies on too. */
const parseCommand = (crossSpawn as unknown as {
  _parse: (command: string, args: string[], options: SpawnOptions) => ParsedCommand;
})._parse;

/**
 * Spawns a command on Windows inside a job object, through the job launcher.
 *
 * @remarks
 * The command is parsed exactly as a direct spawn parses it — cross-spawn's
 * parse, which runs a `.cmd` shim through cmd.exe with its own escaping, and
 * a script with a shebang through the interpreter it names — and the program
 * that parse runs is found the way cross-spawn finds a command. The launcher
 * is given that program's path and the very command line Node would have
 * built to spawn the parse, which it hands to CreateProcessW unchanged. A
 * command that cannot be found is not launched: the direct spawn reports it
 * as usual (cross-spawn turns cmd.exe's "not recognized" into ENOENT).
 *
 * @param launcher - The job launcher's path
 * @param cmd - The command
 * @param args - Its arguments
 * @param options - The spawn options
 * @returns The launcher's process, or null when the command is not found
 */
function spawnInJob(launcher: string, cmd: string, args: string[], options: SpawnOptions): ChildProcess | null {
  const parsed = parseCommand(cmd, args, options);
  if (parsed.file === undefined) return null;
  // The program the parse runs — the command itself, the interpreter its
  // shebang names, or cmd.exe for a shim — which Node would look up by name.
  const application = parseCommand(parsed.command, [], parsed.options).file;
  if (application === undefined) return null;
  const verbatim = parsed.options.windowsVerbatimArguments === true;
  const commandLine = [parsed.command, ...parsed.args].map((arg) => (verbatim ? arg : quoteWindowsArgument(arg))).join(' ');
  return nodeSpawn(launcher, [`"${application}"`, commandLine], {
    ...parsed.options,
    // The launcher's own command line is built here, so Node must pass it as is.
    windowsVerbatimArguments: true,
    argv0: `"${launcher}"`,
  });
}

/**
 * Ends a process and every process it started, on Windows, when it was not
 * started in a job object.
 *
 * @remarks
 * Without the job launcher (see {@link jobLauncher}) there is no container to
 * close: `taskkill /T /F` ends the process and every descendant it finds by
 * parent pid. It misses a program whose parent has exited — Git Bash's exec
 * leaves each program it runs so — and such a program runs on until it ends
 * by itself. taskkill runs by absolute path, so no PATH entry can stand in for
 * it, and only while the child lives: after it exits its pid may name another
 * process. When taskkill cannot run or fails, the child is killed directly.
 *
 * @param child - The direct child, running
 */
function killProcessTree(child: ChildProcess): void {
  const lastResort = (): void => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited
    }
  };
  try {
    const taskkill = nodeSpawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    taskkill.on('error', lastResort);
    taskkill.on('exit', (code) => {
      if (code !== 0 && child.exitCode === null && child.signalCode === null) lastResort();
    });
  } catch {
    lastResort();
  }
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
  /** Streaming stdout callback, called per chunk of whole characters after
   *  tail capture. A returned promise keeps the chunk's bytes pending until it
   *  settles (see {@link maxPendingBytes}). */
  onStdout?: (data: string) => void | Promise<void>;
  /** Streaming stderr callback, as {@link onStdout}. */
  onStderr?: (data: string) => void | Promise<void>;
  /** Per-stream in-memory tail cap in bytes (default 64 KiB). */
  maxLogBytes?: number;
  /** Per stream, the bytes handed to its callback whose promises have not
   *  settled above which the stream is paused (default 1 MiB); it resumes once
   *  they fall to half. A child writing faster than the callback settles then
   *  blocks on its pipe. What is held stays within the cap plus two chunks:
   *  once the child has exited, Node resumes its output to drain it, and one
   *  chunk arrives before the stream is paused again. */
  maxPendingBytes?: number;
  /** Gives the child a stdin pipe this process never writes to — the
   *  lifeline a stock runner spawned with `--exit-with-parent` (spliced into
   *  the argv by `withRunnerLifeline`) reads until end of file, so it exits
   *  when the pipe closes: when this process dies. On Windows the pipe is
   *  overlapped, so the runner keeps full use of its stdin while that read
   *  is pending. The pipe is destroyed once the child has closed. Without it
   *  stdin is ignored. */
  stdinLifeline?: boolean;
  /** Executable dirs prepended to the child PATH ahead of everything else —
   *  a materialized execution environment's bin dir (materializeEnvironment)
   *  must beat both the project venv and node_modules/.bin. */
  extraBins?: string[];
  /** Directories whose ancestor `node_modules/.bin` dirs are prepended to
   *  PATH so runner CLIs resolve (deduped, nearest first). */
  searchDirs?: string[];
  /** Called once the child has spawned, with its pid (or null). The tracked
   *  path uses this to write the `running` execution status. When it throws,
   *  the child is stopped and waited for, and the spawn rejects with its
   *  error. */
  onSpawned?: (pid: number | null) => void | Promise<void>;
}

/**
 * Result of {@link spawnAndCapture}.
 */
export interface SpawnAndCaptureResult {
  /** Process exit code (null if killed by signal or spawn failed) */
  exitCode: number | null;
  /** The signal that ended the process, when one did (null otherwise) */
  signal: NodeJS.Signals | null;
  /** Spawn-failure / non-zero-exit description (null on success) */
  error: string | null;
  /** True if the timeout fired and killed the process group */
  timedOut: boolean;
  /** True if this process killed the process group — because the abort
   *  signal fired or the timeout expired */
  stoppedByE3: boolean;
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
 * augmentation, process-group management on POSIX, stdout/stderr listeners
 * (streaming callbacks of whole characters with backpressure + bounded
 * in-memory tails), process-tree kill, timeout + AbortSignal wiring, and the
 * optional stdin lifeline pipe a runner spawned with `--exit-with-parent`
 * reads, so it exits with this process.
 *
 * Process Lifecycle Management
 * ============================
 * On POSIX we use detached: true to create a new process group, allowing us
 * to kill the entire process tree by signaling the negative PID (process
 * group leader). Process groups are flat, not hierarchical — a task that
 * calls setsid() escapes the kill; that is a known, accepted limitation (see
 * the discussion that used to live in runCommand). Windows has no process
 * group a signal can address: there the child is the job launcher (see
 * {@link jobLauncher}), which runs the command in a job object nothing it
 * starts can leave, and a stop ends the launcher, which ends the job and
 * every process in it. The job ends the same way when this process dies, as
 * Node ends its direct children with it, and when the command exits, so on
 * Windows nothing a runner starts outlives it. Without the launcher a stop
 * ends what {@link killProcessTree} finds, and when this process dies only
 * the direct child ends with it — a stock runner beneath a `.cmd` shim exits
 * through its lifeline instead. The child is never detached on Windows (see
 * the spawn options for why it must not be). On every platform a stop
 * finishes even when a process it could not reach holds the child's output
 * open: once the child has exited, e3 reads on for STOP_DRAIN_MS and then
 * closes the pipes itself.
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
      signal: null,
      error: 'Empty command',
      timedOut: false,
      stoppedByE3: false,
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
  // Also prepend the directory of the running node binary: node-based runner
  // shims (`east-node`) re-exec `node`, so node MUST be resolvable on the spawn
  // PATH. The PATH e3 inherited is not guaranteed to have it — e.g. an
  // in-process e3-api-server inside a VS Code extension host (whose PATH lacks
  // the user's nvm/managed node), or any server started without the user's
  // shell PATH. e3 itself IS node, so `process.execPath`'s dir always holds a
  // working node. The inherited PATH stays as the base.
  const seen = new Set<string>();
  const projectBins = (options.searchDirs ?? [])
    .flatMap((d) => collectNodeModulesBins(d))
    .filter((b) => (seen.has(b) ? false : (seen.add(b), true)));
  // Prepend the project's uv venv bin dir AHEAD of node_modules/.bin so a real
  // `.venv/bin/east-py` (a project-owned Python platform module installed by
  // `uv sync`) beats any `node_modules/.bin` shim of the same name. A uv
  // project has exactly one `.venv`, so collectVenvBins stops at the first hit
  // walking up from each search dir. This is the local degenerate of remote
  // env materialization — purely a child-PATH change, never part of the argv.
  const venvSeen = new Set<string>();
  const venvBins = (options.searchDirs ?? [])
    .flatMap((d) => collectVenvBins(d))
    .filter((b) => (venvSeen.has(b) ? false : (venvSeen.add(b), true)));
  const spawnOpts: Parameters<typeof spawn>[2] = {
    // Run in the per-execution scratch dir, not the caller's cwd. Tasks
    // address inputs/outputs by absolute path and resolve their runner via
    // PATH, so cwd isn't part of the contract — and inheriting the
    // caller's cwd pins it. On Windows a live process's cwd can't be
    // removed, so a child that outlives a killed parent would hold the
    // repo/project dir open and block its cleanup (EBUSY).
    cwd: scratchDir,
    // The lifeline is an overlapped pipe ('overlapped' is 'pipe' off
    // Windows). A runner reads it on a thread of its own for as long as it
    // runs, and on Windows a read pending on a synchronous pipe holds the
    // pipe's file-object lock, so every other operation on stdin in the
    // runner would wait for it — until e3 is gone. Opening process.stdin is
    // one: east-node's first ESM import of `node:process` does it (the
    // builtin's facade reads every export) and never returned. An overlapped
    // read takes no such lock.
    stdio: [options.stdinLifeline ? 'overlapped' : 'ignore', 'pipe', 'pipe'],
    // A process group of its own on POSIX, so a stop reaches the whole tree.
    // Never on Windows: a detached child starts with no console, so a console
    // runner it starts — beneath the job launcher, or beneath cmd.exe running
    // a `.cmd` shim (node for east-node) — is given a new console, and its
    // stdin, stdout and stderr are that console instead of these pipes: its
    // output never reaches e3, and the lifeline watcher, reading a console
    // rather than a pipe, ends the runner as it starts (exit code 1, no
    // stderr). Not detached, the child shares no console with e3 either: with
    // no stdio inherited, `windowsHide` gives it a hidden console of its own.
    detached: process.platform !== 'win32',
    windowsHide: true,
  };
  const pathSep = process.platform === 'win32' ? ';' : ':';
  spawnOpts.env = {
    ...process.env,
    PATH: [...(options.extraBins ?? []), ...venvBins, ...projectBins, path.dirname(process.execPath), process.env.PATH ?? '']
      .filter(Boolean)
      .join(pathSep),
  };
  // Propagate the project search dirs to the runner. The child runs in a scratch
  // cwd (above), so it cannot find the project root on its own — without this a
  // runner CLI can't resolve a project's OWN platform package by Node
  // self-reference (the project package is the repo root, not a node_modules
  // entry). east-node-cli's loader reads this. Like PATH it lives only in the
  // child env, never in the hashed command argv, so taskHash is unaffected.
  const searchDirs = (options.searchDirs ?? []).filter(Boolean);
  if (searchDirs.length > 0) {
    spawnOpts.env.E3_RUNNER_SEARCH_DIRS = [...new Set(searchDirs)].join(pathSep);
  }
  // On Windows each runner runs in a job object, through the job launcher,
  // when this install carries it.
  const launcher = jobLauncher();
  const inJob = launcher === null ? null : spawnInJob(launcher, cmd, cmdArgs, spawnOpts);
  const child = inJob ?? spawn(cmd, cmdArgs, spawnOpts);

  // Set up event listeners IMMEDIATELY before any async work to avoid
  // missing events if the process completes quickly. Capture bounded tails
  // of both streams so callers get a useful diagnostic without ballooning
  // memory on chatty processes.
  const tailBytes = options.maxLogBytes ?? 64 * 1024;
  const maxPendingBytes = options.maxPendingBytes ?? 1024 * 1024;
  let stdoutTail = '';
  let stderrTail = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;
  let stoppedByE3 = false;

  // The lifeline pipe is never written to; an error on it (the child closing
  // its end) is not this process's concern.
  child.stdin?.on('error', () => {});

  const resultPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; error: string | null }>((resolve) => {
    child.on('error', (err) => {
      resolve({ exitCode: null, signal: null, error: `Failed to spawn: ${err.message}` });
    });

    child.on('close', (code, signal) => {
      child.stdin?.destroy();
      if (code === 0) {
        resolve({ exitCode: code, signal, error: null });
      } else {
        const tail = stderrTail.trim();
        const detail = tail ? `\nstderr:\n${tail}` : '';
        resolve({ exitCode: code, signal, error: `Exit code: ${code}${detail}` });
      }
    });
  });

  // Each stream is decoded as whole characters and handed to its callback;
  // while more than `maxPendingBytes` handed over have not settled, the
  // stream is paused, so the child blocks on its pipe.
  const capture = (
    stream: Readable | null,
    record: (data: string) => void,
    callback: ((data: string) => void | Promise<void>) | undefined,
  ): void => {
    if (!stream) return;
    const decoder = new StringDecoder('utf8');
    let pending = 0;
    let paused = false;
    const deliver = (data: string): void => {
      if (data === '') return;
      record(data);
      const settled = callback?.(data);
      if (!settled) return;
      const bytes = Buffer.byteLength(data, 'utf8');
      pending += bytes;
      // Over the cap, paused or not: once the child has exited, Node resumes
      // its output to drain it to the end, over this pause, and a chunk that
      // arrives before the pause is renewed would otherwise be followed by the
      // rest of what the pipe and the stream hold.
      if (pending > maxPendingBytes) {
        paused = true;
        stream.pause();
      }
      const release = (): void => {
        pending -= bytes;
        if (paused && pending <= maxPendingBytes / 2) {
          paused = false;
          stream.resume();
        }
      };
      void settled.then(release, release);
    };
    stream.on('data', (chunk: Buffer) => deliver(decoder.write(chunk)));
    stream.on('end', () => deliver(decoder.end()));
  };

  capture(child.stdout, (str) => {
    const combined = stdoutTail + str;
    if (combined.length > tailBytes) stdoutTruncated = true;
    stdoutTail = combined.slice(-tailBytes);
  }, options.onStdout);

  capture(child.stderr, (str) => {
    const combined = stderrTail + str;
    if (combined.length > tailBytes) stderrTruncated = true;
    stderrTail = combined.slice(-tailBytes);
  }, options.onStderr);

  // Helper to kill the entire process tree (child and all its descendants),
  // once. POSIX: detached, child.pid is the process group leader, so killing
  // -child.pid sends the signal to all processes in that group — which the
  // group keeps, even once its leader has exited, while any member lives.
  // Windows: the child is the job launcher, and ending it closes its job,
  // which ends every process in it; without the launcher, taskkill /T ends
  // what it finds. Only while the child lives: once it has exited its job has
  // closed, and its pid may name another process.
  let groupKilled = false;
  const killProcessGroup = () => {
    if (groupKilled || !child.pid) return;
    groupKilled = true;
    if (process.platform === 'win32') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (inJob === null) {
        killProcessTree(child);
        return;
      }
      try {
        child.kill('SIGKILL');
      } catch {
        // Already exited
      }
      return;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Process may have already exited
    }
  };
  // Once the child e3 stopped has exited, its output is read for
  // STOP_DRAIN_MS more, and then the pipes are closed from this side: a
  // process the stop could not reach — one that left the process group, or
  // on Windows one taskkill could not find when there is no job launcher —
  // would otherwise hold them open, and the stop would never finish. (Go's
  // exec.Cmd.WaitDelay bounds the same wait.)
  let drainTimer: NodeJS.Timeout | undefined;
  const drainAfterStop = (): void => {
    if (drainTimer !== undefined) return;
    drainTimer = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, STOP_DRAIN_MS);
  };
  child.on('exit', () => {
    if (stoppedByE3) drainAfterStop();
  });
  // The kills this process decides on, as opposed to any other signal.
  const stopProcessGroup = () => {
    stoppedByE3 = true;
    if (child.exitCode !== null || child.signalCode !== null) drainAfterStop();
    killProcessGroup();
  };

  // Handle timeout
  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeoutMs) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      stopProcessGroup();
    }, options.timeoutMs);
  }

  // Handle abort signal
  if (options.signal) {
    if (options.signal.aborted) {
      // Already aborted before we started
      stopProcessGroup();
    } else {
      options.signal.addEventListener('abort', stopProcessGroup, { once: true });
    }
  }

  // Notify the caller of the spawned pid (tracked path writes its
  // `running` status here). A caller that cannot record the runner fails
  // the spawn, and the runner is stopped and waited for first, so it is never
  // left running with nothing tracking it.
  let spawnedFailure: { error: unknown } | null = null;
  if (options.onSpawned) {
    try {
      await options.onSpawned(child.pid ?? null);
    } catch (error) {
      spawnedFailure = { error };
      stopProcessGroup();
    }
  }

  // Wait for process to complete
  const result = await resultPromise;

  // Cleanup
  if (drainTimer) clearTimeout(drainTimer);
  if (timeoutId) clearTimeout(timeoutId);
  if (options.signal) {
    options.signal.removeEventListener('abort', stopProcessGroup);
  }
  if (spawnedFailure !== null) throw spawnedFailure.error;

  return {
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error,
    timedOut,
    stoppedByE3,
    stdoutTail,
    stderrTail,
    stdoutTruncated,
    stderrTruncated,
  };
}
