/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 start command - Execute tasks in a workspace
 *
 * Usage:
 *   e3 start . my-workspace
 *   e3 start . my-workspace --concurrency 2
 *   e3 start . my-workspace --force
 *   e3 start https://server/repos/myrepo my-workspace
 */

import { join } from 'node:path';
import {
  DataflowAbortedError,
  LocalStorage,
  LocalOrchestrator,
  FileStateStore,
  workspaceGetTree,
  type TaskCompletedCallback,
  type TreeNode,
} from '@elaraai/e3-core';
import {
  dataflowStart as dataflowStartRemote,
  dataflowExecution as dataflowExecutionRemote,
  datasetListRecursive as datasetListRecursiveRemote,
  type DataflowEvent,
  type DataflowExecutionState,
} from '@elaraai/e3-api-client';
import { type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError, type RepoLocation } from '../utils.js';
import { formatSize } from '../format.js';

/** Polling interval for remote execution (ms) */
const POLL_INTERVAL = 500;

/**
 * Execute tasks in a workspace.
 */
export async function startCommand(
  repoArg: string,
  ws: string,
  options: { filter?: string; concurrency?: string; force?: boolean }
): Promise<void> {
  // Set up abort controller for signal handling
  const controller = new AbortController();
  let aborted = false;

  // Handle SIGINT (Ctrl+C) and SIGTERM gracefully
  const signalHandler = (signal: string) => {
    console.log('');
    console.log(`Received ${signal}, aborting...`);
    aborted = true;
    controller.abort();
  };

  process.on('SIGINT', () => signalHandler('SIGINT'));
  process.on('SIGTERM', () => signalHandler('SIGTERM'));

  try {
    const location = await parseRepoLocation(repoArg);
    const concurrency = options.concurrency ? parseInt(options.concurrency, 10) : 4;

    console.log(`Starting tasks in workspace: ${ws}`);
    if (options.filter) {
      console.log(`Filter: ${options.filter}`);
    }
    console.log(`Concurrency: ${concurrency}`);
    if (options.force) {
      console.log('Force: re-executing all tasks');
    }
    console.log('');

    if (location.type === 'local') {
      await executeLocal(location.path, ws, {
        concurrency,
        force: options.force,
        filter: options.filter,
        signal: controller.signal,
      });
    } else {
      await executeRemote(
        location.baseUrl,
        location.repo,
        ws,
        {
          concurrency,
          force: options.force,
          filter: options.filter,
        },
        location.token,
        () => aborted
      );
    }
  } catch (err) {
    if (err instanceof DataflowAbortedError) {
      console.log('');
      console.log('Aborted.');
      if (err.partialResults && err.partialResults.length > 0) {
        const completed = err.partialResults.filter(r => r.state === 'success').length;
        console.log(`  Completed before abort: ${completed}`);
      }
      process.exit(130); // Standard exit code for SIGINT (128 + 2)
    }
    exitError(formatError(err));
  }
}

// =============================================================================
// Local Execution
// =============================================================================

interface LocalExecuteOptions {
  concurrency: number;
  force?: boolean;
  filter?: string;
  signal: AbortSignal;
}

async function executeLocal(
  repoPath: string,
  ws: string,
  options: LocalExecuteOptions
): Promise<void> {
  const storage = new LocalStorage();
  const workspacesDir = join(repoPath, 'workspaces');
  const stateStore = new FileStateStore(workspacesDir);
  const orchestrator = new LocalOrchestrator(stateStore);

  const handle = await orchestrator.start(storage, repoPath, ws, {
    concurrency: options.concurrency,
    force: options.force,
    filter: options.filter,
    signal: options.signal,
    onTaskStart: (name) => {
      console.log(`  [START] ${name}`);
    },
    onTaskComplete: (taskResult: TaskCompletedCallback) => {
      printTaskResult(taskResult);
    },
  });

  const result = await orchestrator.wait(handle);

  printSummary({
    executed: result.executed,
    cached: result.cached,
    failed: result.failed,
    skipped: result.skipped,
    duration: result.duration,
  });

  if (result.success) {
    await printOutputs({ type: 'local', path: repoPath }, ws);
  }

  if (!result.success) {
    // Get failed task details from state store
    const state = await stateStore.read(repoPath, ws, handle.id);
    let failedTasks: TaskCompletedCallback[] = [];
    if (state) {
      for (const [name, taskState] of state.tasks) {
        if (taskState.status === 'failed') {
          failedTasks.push({
            name,
            cached: false,
            state: 'failed',
            error: taskState.error.type === 'some' ? taskState.error.value : undefined,
            exitCode: taskState.exitCode.type === 'some' ? Number(taskState.exitCode.value) : undefined,
            duration: taskState.duration.type === 'some' ? Number(taskState.duration.value) : 0,
          });
        }
      }
      printFailedTasks(failedTasks);
    }
    // Fallback: result.success was false but no per-task failure was found —
    // the orchestrator failed at a layer above task execution (state load,
    // version vector conflict, lock, …). Emit SOMETHING on stderr so
    // callers don't see a bare non-zero exit with empty stderr (was
    // misdiagnosed as a CI flake more than once during PR work).
    if (failedTasks.length === 0) {
      console.error('');
      console.error(
        `Dataflow failed without any task-level failure recorded ` +
        `(executed=${result.executed}, failed=${result.failed}, skipped=${result.skipped}). ` +
        `Likely an orchestrator-level error before tasks started; check storage/state-store logs.`,
      );
    }
    process.exit(1);
  }
}

// =============================================================================
// Remote Execution
// =============================================================================

interface RemoteExecuteOptions {
  concurrency: number;
  force?: boolean;
  filter?: string;
}

async function executeRemote(
  baseUrl: string,
  repo: string,
  ws: string,
  options: RemoteExecuteOptions,
  token: string,
  isAborted: () => boolean
): Promise<void> {
  const requestOptions = { token };

  // Start the dataflow execution
  await dataflowStartRemote(baseUrl, repo, ws, {
    concurrency: options.concurrency,
    force: options.force,
    filter: options.filter,
  }, requestOptions);

  // Poll for execution state
  let eventOffset = 0;
  let lastStatus: DataflowExecutionState['status']['type'] | null = null;

  while (!isAborted()) {
    const state = await dataflowExecutionRemote(baseUrl, repo, ws, {
      offset: eventOffset,
    }, requestOptions);

    // Print new events
    for (const event of state.events) {
      printEvent(event);
      eventOffset++;
    }

    // Check if execution is done
    if (state.status.type !== 'running') {
      lastStatus = state.status.type;

      // Print summary if available
      if (state.summary.type === 'some') {
        const summary = state.summary.value;
        printSummary({
          executed: Number(summary.executed),
          cached: Number(summary.cached),
          failed: Number(summary.failed),
          skipped: Number(summary.skipped),
          duration: summary.duration,
        });
      }

      if (lastStatus === 'completed') {
        await printOutputs({ type: 'remote', baseUrl, repo, token }, ws);
      }

      break;
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL);
  }

  // Handle abort
  if (isAborted()) {
    console.log('');
    console.log('Aborted.');
    process.exit(130);
  }

  // Exit with error if execution failed
  if (lastStatus === 'failed') {
    process.exit(1);
  }
}

// =============================================================================
// Output Formatting
// =============================================================================

function printEvent(event: DataflowEvent): void {
  switch (event.type) {
    case 'start':
      console.log(`  [START] ${event.value.task}`);
      break;
    case 'complete':
      console.log(`  [DONE] ${event.value.task} [${Math.round(event.value.duration)}ms]`);
      break;
    case 'cached':
      console.log(`  [CACHED] ${event.value.task}`);
      break;
    case 'failed':
      console.log(`  [FAIL] ${event.value.task} [${Math.round(event.value.duration)}ms] (exit code ${event.value.exitCode})`);
      break;
    case 'error':
      console.log(`  [ERR] ${event.value.task}: ${event.value.message}`);
      break;
    case 'input_unavailable':
      console.log(`  [SKIP] ${event.value.task}`);
      break;
  }
}

function printTaskResult(result: TaskCompletedCallback): void {
  if (result.cached) {
    console.log(`  [CACHED] ${result.name}`);
    return;
  }

  switch (result.state) {
    case 'success':
      console.log(`  [DONE] ${result.name} [${Math.round(result.duration)}ms]`);
      break;
    case 'failed': {
      const exitCode = result.exitCode ?? -1;
      console.log(`  [FAIL] ${result.name} [${Math.round(result.duration)}ms] (exit code ${exitCode})`);
      break;
    }
    case 'error':
      console.log(`  [ERR] ${result.name}: ${result.error ?? 'Unknown error'}`);
      break;
    case 'skipped':
      console.log(`  [SKIP] ${result.name}`);
      break;
  }
}

interface Summary {
  executed: number;
  cached: number;
  failed: number;
  skipped: number;
  duration: number;
}

function printSummary(summary: Summary): void {
  console.log('');
  console.log('Summary:');
  console.log(`  Executed: ${summary.executed}`);
  console.log(`  Cached:   ${summary.cached}`);
  console.log(`  Failed:   ${summary.failed}`);
  console.log(`  Skipped:  ${summary.skipped}`);
  console.log(`  Duration: ${Math.round(summary.duration)}ms`);
}

function printFailedTasks(tasks: TaskCompletedCallback[]): void {
  // Stderr, not stdout — `e3 dataflow start` exits non-zero in this branch,
  // so the failure summary belongs on the error stream where callers (CI
  // scripts, fuzz harness, anything that asserts on exit code) look for
  // diagnostics. Was the source of empty "start failed:" messages in the
  // fuzz harness when every line of failure detail was going to stdout.
  console.error('');
  console.error('Failed tasks:');
  for (const task of tasks) {
    if (task.state === 'failed') {
      const exitInfo = task.exitCode != null ? `exit code ${task.exitCode}` : 'spawn failed';
      const errorInfo = task.error ? ` - ${task.error}` : '';
      console.error(`  ${task.name}: ${exitInfo}${errorInfo}`);
    } else if (task.state === 'error') {
      console.error(`  ${task.name}: ${task.error}`);
    }
  }
}

/**
 * After a successful dataflow run, list task outputs as flat paths so the user
 * can copy them straight into a follow-up `e3 dataset get` without having to
 * walk the tree themselves.
 *
 * Inputs are intentionally omitted — they were set by the user, not produced
 * by the run.
 */
async function printOutputs(location: RepoLocation, ws: string): Promise<void> {
  try {
    const rows: { name: string; size: string }[] = [];

    if (location.type === 'local') {
      const storage = new LocalStorage();
      const tree = await workspaceGetTree(storage, location.path, ws, [], {
        includeTypes: true,
        includeStatus: true,
      });
      for (const node of collectTaskOutputNodes(tree)) {
        rows.push({
          name: `${ws}.${node.name}`,
          size: formatLeafSize(node.refType, node.size),
        });
      }
    } else {
      const items = await datasetListRecursiveRemote(
        location.baseUrl, location.repo, ws, [],
        { token: location.token },
      );
      for (const item of items) {
        if (item.type !== 'dataset') continue;
        const segments = item.value.path.split('.').filter(s => s.length > 0);
        if (segments.length !== 2 || segments[0] !== 'tasks') continue;
        const v = item.value;
        const refTypeStr = v.hash.type === 'none' && v.size.type === 'none'
          ? 'unassigned'
          : v.size.type === 'some' && v.size.value === 0n ? 'null' : 'value';
        rows.push({
          name: `${ws}.${segments[1]!}`,
          size: refTypeStr === 'value' && v.size.type === 'some'
            ? formatSize(Number(v.size.value))
            : refTypeStr === 'null' ? '0 B' : '-',
        });
      }
    }

    if (rows.length === 0) return;

    rows.sort((a, b) => a.name.localeCompare(b.name));
    const nameW = Math.max(...rows.map(r => r.name.length));
    console.log('');
    console.log('Outputs:');
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(nameW)}  ${r.size}`);
    }
  } catch {
    // Don't fail the run because we couldn't print outputs.
  }
}

/** Collect task-output leaves from a workspace tree (collapsed by workspaceGetTree). */
function collectTaskOutputNodes(nodes: TreeNode[]): Array<TreeNode & { kind: 'dataset'; datasetType?: EastTypeValue; refType?: string; size?: number }> {
  const tasksBranch = nodes.find(n => n.kind === 'tree' && n.name === 'tasks');
  if (!tasksBranch || tasksBranch.kind !== 'tree') return [];
  return tasksBranch.children.filter(n => n.kind === 'dataset') as Array<TreeNode & { kind: 'dataset' }>;
}

/** Format the size column based on ref state. */
function formatLeafSize(refType: string | undefined, size: number | undefined): string {
  if (refType === 'unassigned') return '-';
  if (refType === 'null') return '0 B';
  if (size !== undefined) return formatSize(size);
  return '-';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
