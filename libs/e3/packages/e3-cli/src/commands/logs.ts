/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 logs command - View execution logs for workspace tasks
 *
 * Usage:
 *   e3 logs . ws                    # List tasks in workspace
 *   e3 logs . ws.taskName           # Show the last 200 lines
 *   e3 logs . ws.taskName -n 50     # Show the last 50 lines
 *   e3 logs . ws.taskName --all     # Show the whole log
 *   e3 logs . ws.taskName --follow  # Follow log output
 */

import {
  workspaceListTasks,
  workspaceGetTaskHash,
  executionListForTask,
  executionReadLog,
  executionGetLatest,
  executionFindCurrent,
  isProcessAlive,
  LocalStorage,
  type StorageBackend,
} from '@elaraai/e3-core';
import { decodeTaskObject } from '@elaraai/e3-types';
import {
  taskList as taskListRemote,
  taskExecutionList as taskExecutionListRemote,
  taskLogs as taskLogsRemote,
  ApiError,
} from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError, HASH_DISPLAY_WIDTH } from '../utils.js';
import { formatSize } from '../format.js';

/** Bytes requested per read when paging through a log. */
const PAGE_BYTES = 64 * 1024;

/** Trailing lines shown when neither `-n/--lines` nor `--all` is given. */
export const DEFAULT_TAIL_LINES = 200;

/**
 * How far back a tail read scans before settling for the lines it has. Only
 * reached by logs whose lines are enormous; the notice still reports what was
 * shown against the full size.
 */
const MAX_TAIL_BYTES = 8 * 1024 * 1024;

/**
 * Format a hash for display (abbreviated to `HASH_DISPLAY_WIDTH`).
 */
function abbrev(hash: string): string {
  return hash.slice(0, HASH_DISPLAY_WIDTH);
}

/**
 * Parse task path: ws.taskName
 */
function parseTaskPath(pathSpec: string): { ws: string; taskName?: string } {
  const dotIndex = pathSpec.indexOf('.');
  if (dotIndex === -1) {
    return { ws: pathSpec };
  }
  return {
    ws: pathSpec.slice(0, dotIndex),
    taskName: pathSpec.slice(dotIndex + 1),
  };
}

/**
 * List tasks in a workspace with their execution status.
 */
async function listWorkspaceTasks(storage: StorageBackend, repoPath: string, ws: string): Promise<void> {
  const tasks = await workspaceListTasks(storage, repoPath, ws);

  if (tasks.length === 0) {
    console.log(`No tasks in workspace: ${ws}`);
    return;
  }

  console.log(`Tasks in workspace: ${ws}`);
  console.log('');

  for (const taskName of tasks) {
    const taskHash = await workspaceGetTaskHash(storage, repoPath, ws, taskName);
    const executions = await executionListForTask(storage, repoPath, taskHash);

    // Surface the task kind (partition / stream / ui) next to the name.
    let kindLabel = '';
    try {
      const task = decodeTaskObject(Buffer.from(await storage.objects.read(repoPath, taskHash)));
      if (task.kind.type === 'some') kindLabel = ` <${task.kind.value}>`;
    } catch {
      // A missing/undecodable task object only loses the label.
    }

    if (executions.length === 0) {
      console.log(`  ${taskName}${kindLabel}  (no executions)`);
    } else {
      // Get status of the most recent execution
      const latestInHash = executions[0]!;
      const status = await executionGetLatest(storage, repoPath, taskHash, latestInHash);
      let state = status?.type ?? 'unknown';

      // Check if running process is actually alive
      if (status?.type === 'running') {
        const pid = Number(status.value.pid);
        const pidStartTime = Number(status.value.pidStartTime);
        const bootId = status.value.bootId;
        const alive = await isProcessAlive(pid, pidStartTime, bootId);
        if (!alive) {
          state = 'stale-running';
        }
      }

      console.log(`  ${taskName}${kindLabel}  [${state}] (${executions.length} execution(s))`);
    }
  }

  console.log('');
  console.log(`Use "e3 logs . ${ws}.<taskName>" to view logs.`);
}


/** Normalized log chunk with plain numbers. */
interface LogData {
  data: string;
  offset: number;
  size: number;
  totalSize: number;
  complete: boolean;
}

/** Reads up to `limit` bytes of `stream` starting at byte `offset`. */
type ReadFn = (stream: 'stdout' | 'stderr', offset: number, limit: number) => Promise<LogData>;

/** How much of a log to show. */
interface DisplayOptions {
  follow: boolean;
  all: boolean;
  /** Trailing lines to show when `all` is false. */
  lines: number;
}

/**
 * Resolve the `-n/--lines` option.
 *
 * @param value - Raw option value, or undefined when the flag was not given
 * @returns The number of trailing lines to show
 * @throws {Error} If the value is not a positive integer
 */
export function parseLines(value: string | number | undefined): number {
  if (value === undefined) return DEFAULT_TAIL_LINES;
  const lines = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(lines) || lines <= 0) {
    throw new Error(`Invalid --lines value: ${String(value)} (expected a positive integer)`);
  }
  return lines;
}

/**
 * Take the last `maxLines` lines of `text`.
 *
 * @param text - Log text, whole lines only
 * @param maxLines - Maximum number of lines to keep
 * @returns The kept lines joined by newlines (no trailing newline), how many
 *   there are, and whether earlier lines were dropped
 */
export function lastLines(
  text: string,
  maxLines: number
): { text: string; lines: number; truncated: boolean } {
  const all = text.split('\n');
  // A trailing newline yields a final empty element that is not a line.
  if (all[all.length - 1] === '') all.pop();
  const truncated = all.length > maxLines;
  const kept = truncated ? all.slice(all.length - maxLines) : all;
  return { text: kept.join('\n'), lines: kept.length, truncated };
}

/** The trailing slice of a log stream. */
export interface TailView {
  /** Whole lines, newline-joined, without a trailing newline. */
  text: string;
  /** Number of lines in `text`. */
  lines: number;
  /** True when the log holds earlier lines that `text` does not include. */
  truncated: boolean;
  /** Size of the whole stream in bytes. */
  totalSize: number;
}

/**
 * Read the last `maxLines` lines of a log stream.
 *
 * Reads a window from the end of the stream and widens it until it holds
 * enough lines, so tailing a large log costs a couple of reads rather than a
 * full download.
 *
 * @param read - Log reader
 * @param stream - Which stream to read
 * @param maxLines - Maximum number of trailing lines to return
 * @returns The trailing lines and the size they were taken from
 */
export async function readTail(
  read: ReadFn,
  stream: 'stdout' | 'stderr',
  maxLines: number
): Promise<TailView> {
  // Read the head first: it costs one read either way, and it is the whole
  // log for the common case of a stream that fits in a single page.
  const head = await read(stream, 0, PAGE_BYTES);
  if (head.complete) {
    return { ...lastLines(head.data, maxLines), totalSize: head.totalSize };
  }

  const totalSize = head.totalSize;
  for (let windowBytes = PAGE_BYTES; ; windowBytes = Math.min(windowBytes * 8, MAX_TAIL_BYTES)) {
    const start = Math.max(0, totalSize - windowBytes);
    const chunk = await read(stream, start, totalSize - start);
    // A window opening mid-file opens mid-line: drop the leading partial line
    // (which is also where a byte offset can split a character).
    const newline = chunk.data.indexOf('\n');
    const data = start === 0 ? chunk.data : newline === -1 ? '' : chunk.data.slice(newline + 1);

    const tail = lastLines(data, maxLines);
    if (start === 0) return { ...tail, totalSize };
    if (tail.lines >= maxLines || windowBytes >= MAX_TAIL_BYTES) {
      return { text: tail.text, lines: tail.lines, truncated: true, totalSize };
    }
  }
}

/**
 * Page a log stream from `offset` to its end, writing each chunk out as it
 * arrives so a multi-megabyte log is never held whole in memory.
 *
 * @param read - Log reader
 * @param stream - Which stream to read
 * @param offset - Byte offset to start from
 * @param out - Destination for the log text
 * @returns The offset just past the last byte written, and whether that byte
 *   was a newline
 */
export async function pipeToEnd(
  read: ReadFn,
  stream: 'stdout' | 'stderr',
  offset: number,
  out: { write(chunk: string): unknown }
): Promise<{ end: number; endsWithNewline: boolean }> {
  let end = offset;
  let endsWithNewline = true;
  for (;;) {
    const chunk = await read(stream, end, PAGE_BYTES);
    if (chunk.size === 0) return { end, endsWithNewline };
    out.write(chunk.data);
    end += chunk.size;
    endsWithNewline = chunk.data.endsWith('\n');
    if (chunk.complete) return { end, endsWithNewline };
  }
}

/** A stream's opening slice, plus where the rest of it starts. */
interface StreamView {
  /** Text ready to print (empty in `--all` mode, which streams from `next`). */
  text: string;
  /** Byte offset the remaining output starts at. */
  next: number;
  totalSize: number;
  /** Notice explaining what was left out, or null when nothing was. */
  notice: string | null;
}

/** Read as much of a stream as `options` calls for, without printing it. */
async function openStream(
  read: ReadFn,
  stream: 'stdout' | 'stderr',
  options: DisplayOptions
): Promise<StreamView> {
  if (options.all) {
    // A zero-length read is the cheapest way to learn the size, which decides
    // whether this stream gets a banner at all.
    const probe = await read(stream, 0, 0);
    return { text: '', next: 0, totalSize: probe.totalSize, notice: null };
  }

  const tail = await readTail(read, stream, options.lines);
  return {
    text: tail.text,
    next: tail.totalSize,
    totalSize: tail.totalSize,
    notice: tail.truncated
      ? `[showing the last ${tail.lines} lines of ${formatSize(tail.totalSize)} — use -n <lines> or --all for the rest]`
      : null,
  };
}

/**
 * Print one stream, returning the offset at the end of the log — where
 * `--follow` picks up.
 */
async function printStream(
  label: string,
  view: StreamView,
  read: ReadFn,
  stream: 'stdout' | 'stderr',
  all: boolean
): Promise<number> {
  console.log(`=== ${label} ===`);
  if (view.notice !== null) console.log(view.notice);

  if (!all) {
    console.log(view.text);
    return view.next;
  }

  const { end, endsWithNewline } = await pipeToEnd(read, stream, view.next, process.stdout);
  if (!endsWithNewline) process.stdout.write('\n');
  return end;
}

/**
 * Display logs and optionally follow for new output.
 */
async function displayLogs(read: ReadFn, options: DisplayOptions): Promise<void> {
  const stdout = await openStream(read, 'stdout', options);
  const stderr = await openStream(read, 'stderr', options);

  if (stdout.totalSize === 0 && stderr.totalSize === 0) {
    console.log('No log output.');
    return;
  }

  // Following resumes at the end of the whole log, not the end of what was
  // printed, so a tailed or truncated first read still hands over to live
  // output instead of replaying the backlog.
  let stdoutOffset = stdout.totalSize;
  let stderrOffset = stderr.totalSize;

  if (stdout.totalSize > 0) {
    stdoutOffset = await printStream('STDOUT', stdout, read, 'stdout', options.all);
  }

  if (stderr.totalSize > 0) {
    if (stdout.totalSize > 0) {
      console.log('');
    }
    stderrOffset = await printStream('STDERR', stderr, read, 'stderr', options.all);
  }

  if (options.follow) {
    console.log('');
    console.log('[Following... press Ctrl+C to stop]');

    const pollInterval = 500; // ms
    const tick = async () => {
      const newStdout = await read('stdout', stdoutOffset, PAGE_BYTES);
      const newStderr = await read('stderr', stderrOffset, PAGE_BYTES);

      if (newStdout.size > 0) {
        process.stdout.write(newStdout.data);
        stdoutOffset += newStdout.size;
      }

      if (newStderr.size > 0) {
        process.stderr.write(newStderr.data);
        stderrOffset += newStderr.size;
      }
    };

    const intervalId = setInterval(() => void tick(), pollInterval);
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\n[Stopped]');
      process.exit(0);
    });

    // Keep the process alive — interrupted by Ctrl+C
    await new Promise(() => {});
  }
}

/**
 * List tasks in a workspace (remote).
 */
async function listWorkspaceTasksRemote(
  baseUrl: string,
  repo: string,
  ws: string,
  token: string
): Promise<void> {
  const tasks = await taskListRemote(baseUrl, repo, ws, { token });

  if (tasks.length === 0) {
    console.log(`No tasks in workspace: ${ws}`);
    return;
  }

  console.log(`Tasks in workspace: ${ws}`);
  console.log('');

  for (const task of tasks) {
    const executions = await taskExecutionListRemote(baseUrl, repo, ws, task.name, { token });
    const kindLabel = task.kind.type === 'some' ? ` <${task.kind.value}>` : '';

    if (executions.length === 0) {
      console.log(`  ${task.name}${kindLabel}  (no executions)`);
    } else {
      // Get status of the most recent execution
      const latest = executions[0]!;
      const state = latest.status.type;
      console.log(`  ${task.name}${kindLabel}  [${state}] (${executions.length} execution(s))`);
    }
  }

  console.log('');
  console.log(`Use "e3 logs <repo> ${ws}.<taskName>" to view logs.`);
}

/** Convert a remote LogChunk (bigint fields) to LogData. */
function toLogData(chunk: Awaited<ReturnType<typeof taskLogsRemote>>): LogData {
  return {
    data: chunk.data,
    offset: Number(chunk.offset),
    size: Number(chunk.size),
    totalSize: Number(chunk.totalSize),
    complete: chunk.complete,
  };
}

/**
 * View execution logs for workspace tasks.
 */
export async function logsCommand(
  repoArg: string,
  pathSpec?: string,
  options: { follow?: boolean; lines?: string | number; all?: boolean } = {}
): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const display: DisplayOptions = {
      follow: options.follow ?? false,
      all: options.all ?? false,
      lines: parseLines(options.lines),
    };

    if (!pathSpec) {
      exitError('Usage: e3 logs <repo> <ws> or e3 logs <repo> <ws.taskName>');
    }

    // Parse the path: ws or ws.taskName
    const { ws, taskName } = parseTaskPath(pathSpec);

    if (location.type === 'local') {
      const storage = new LocalStorage();

      if (!taskName) {
        // No task specified - list tasks in workspace
        await listWorkspaceTasks(storage, location.path, ws);
        return;
      }

      // Find the execution for this task
      const execution = await executionFindCurrent(storage, location.path, ws, taskName);

      if (!execution) {
        exitError(`No executions found for task: ${ws}.${taskName}`);
      }

      const { taskHash, inputsHash, executionId } = execution;

      console.log(`Task: ${ws}.${taskName}`);
      console.log(`Execution: ${abbrev(taskHash)}/${abbrev(inputsHash)}/${abbrev(executionId)}`);
      console.log('');

      await displayLogs(
        (stream, offset, limit) =>
          executionReadLog(storage, location.path, taskHash, inputsHash, executionId, stream, { offset, limit }),
        display
      );
    } else {
      // Remote
      if (!taskName) {
        // No task specified - list tasks in workspace
        await listWorkspaceTasksRemote(location.baseUrl, location.repo, ws, location.token);
        return;
      }

      console.log(`Task: ${ws}.${taskName}`);
      console.log('');

      const { baseUrl, repo, token } = location;
      await displayLogs(async (stream, offset, limit) => {
        try {
          return toLogData(
            await taskLogsRemote(baseUrl, repo, ws, taskName, { stream, offset, limit }, { token })
          );
        } catch (err) {
          if (err instanceof ApiError && err.code === 'execution_not_found') {
            exitError(`No executions found for task: ${ws}.${taskName}`);
          }
          throw err;
        }
      }, display);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
