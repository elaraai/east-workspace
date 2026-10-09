/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 dataflow run command - Execute tasks in a workspace
 *
 * Usage:
 *   e3 dataflow run . my-workspace
 *   e3 dataflow run . my-workspace --jobs 2 --memory 8G
 *   e3 dataflow run . my-workspace --force
 *   e3 dataflow run . my-workspace --force-task import_sales --force-task import_stock
 *   e3 dataflow run https://server/repos/myrepo my-workspace
 */

import { join } from 'node:path';
import {
  DataflowAbortedError,
  LocalStorage,
  LocalOrchestrator,
  LocalTaskRunner,
  FileStateStore,
  sweepScratchDirs,
  workspaceGetTree,
  type Budget,
  type TaskCompletedCallback,
  type TreeNode,
} from '@elaraai/e3-core';
import {
  dataflowExecuteLaunch as dataflowExecuteLaunchRemote,
  dataflowExecutePoll as dataflowExecutePollRemote,
  dataflowEventsRemain,
  dataflowCancel as dataflowCancelRemote,
  datasetListRecursive as datasetListRecursiveRemote,
  type DataflowEvent,
  type DataflowExecutionState,
} from '@elaraai/e3-api-client';
import { IntegerType, lessFor, type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError, type RepoLocation } from '../utils.js';
import { getValidToken } from '../credentials.js';
import { formatRequeue, formatSize } from '../format.js';
import { commandBudget, refuseRemoteBudget, type BudgetFlags } from './budget.js';
import { openRackRunner } from '@elaraai/e3-rack';
import { rackEnabled, refuseRemoteRack, printRackPlacement, type RackFlags } from './rack-options.js';

/** Polling interval for remote execution (ms) */
const POLL_INTERVAL = 500;

/** Whether one event sequence number comes before another. */
const seqBefore = lessFor(IntegerType);

/**
 * The tasks a run forces, from its flags: `--force` every task the run runs —
 * under `--filter`, the filter's task — and each `--force-task` the task it
 * names.
 *
 * @param flags - The run's `--force` and `--force-task` flags
 * @returns `true` for every task, the tasks named, or `undefined` for none
 * @throws {Error} When given both, which say different things
 */
export function forcedTasks(flags: { force?: boolean; forceTask?: readonly string[] }): true | readonly string[] | undefined {
  if (flags.forceTask === undefined) return flags.force === true ? true : undefined;
  if (flags.force === true) {
    throw new Error('--force forces every task the run runs, and --force-task only the tasks it names: give one or the other');
  }
  return flags.forceTask;
}

/**
 * Execute tasks in a workspace.
 */
export async function startCommand(
  repoArg: string,
  ws: string,
  options: BudgetFlags & RackFlags & { filter?: string; force?: boolean; forceTask?: string[]; verbose?: boolean }
): Promise<void> {
  // Set up abort controller for signal handling
  const controller = new AbortController();
  let aborted = false;

  // Handle SIGINT (Ctrl+C), SIGTERM and SIGHUP (a closed terminal) gracefully
  const signalHandler = (signal: string) => {
    console.log('');
    console.log(`Received ${signal}, aborting...`);
    aborted = true;
    controller.abort();
  };

  process.on('SIGINT', () => signalHandler('SIGINT'));
  process.on('SIGTERM', () => signalHandler('SIGTERM'));
  process.on('SIGHUP', () => signalHandler('SIGHUP'));

  try {
    const force = forcedTasks(options);
    refuseRemoteRack(repoArg, options);
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'remote') refuseRemoteBudget(options);
    // A local run's budget: the cores and memory its runner processes take,
    // across the dataflow's tasks and the units of its split tasks.
    const budget = location.type === 'local' ? commandBudget(options) : null;

    console.log(`Starting tasks in workspace: ${ws}`);
    if (options.filter) {
      console.log(`Filter: ${options.filter}`);
    }
    if (budget !== null) {
      console.log(`Budget: ${budget.cores} ${budget.cores === 1 ? 'core' : 'cores'}, ${formatSize(budget.memory)}`);
    }
    if (force === true) {
      console.log(
        options.filter
          ? `Force: re-executing ${options.filter} (dependencies from cache)`
          : 'Force: re-executing all tasks'
      );
    } else if (force !== undefined) {
      console.log(`Force: re-executing ${force.join(', ')}`);
    }
    console.log('');

    if (location.type === 'local') {
      await executeLocal(location.path, ws, {
        budget: budget!,
        force,
        verbose: options.verbose,
        filter: options.filter,
        signal: controller.signal,
        rack: options.rack,
        rackOnly: options.rackOnly,
      });
    } else {
      await executeRemote(
        location.baseUrl,
        location.repo,
        ws,
        {
          force,
          filter: options.filter,
          verbose: options.verbose,
        },
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

interface LocalExecuteOptions extends RackFlags {
  /** The run's budget: the cores and memory its runner processes take, tasks
   *  and the units of split tasks alike. */
  budget: Budget;
  /** The tasks the run forces: `true` for every task, or the tasks named */
  force?: true | readonly string[];
  verbose?: boolean;
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

  // Scratch directories an earlier run left behind when its process died.
  try {
    await sweepScratchDirs(repoPath);
  } catch {
    // Not a reason to fail the run
  }

  // The loop keeps as many tasks and units in flight as the budget has cores;
  // the runner, which holds the budget, decides which of them spawn.
  const rack = await rackEnabled(repoPath, options) ? await openRackRunner({ repoPath, workspace: ws, storage,
    label: `e3 dataflow run ${ws} (pid ${process.pid})`, budget: options.budget, rackOnly: options.rackOnly,
    onPlacement: printRackPlacement, log: console.log }) : undefined;
  if (rack !== undefined) console.log(`Rack: ${rack.describe()}`);
  try {
    const handle = await orchestrator.start(storage, repoPath, ws, {
      runner: rack?.runner ?? new LocalTaskRunner(repoPath, options.budget),
      width: options.budget.cores + (rack?.rackSlots ?? 0),
      force: options.force,
      verbose: options.verbose,
      filter: options.filter,
      signal: options.signal,
      onTaskStart: (name) => {
        console.log(`  [START] ${name}`);
      },
      onTaskComplete: (taskResult: TaskCompletedCallback) => {
        printTaskResult(taskResult);
      },
      onPartitionProgress: (task, progress) => {
        if (progress.state !== 'completed') return;
        const cached = progress.cached ? ' (cached)' : '';
        const duration = `[${Math.round(progress.duration ?? 0)}ms]`;
        if (progress.phase === 'partition') {
          console.log(`  [PART] ${task} ${progress.completed}/${progress.total} #${progress.index + 1}${cached} ${duration}`);
        } else {
          const label = progress.phase === 'merge' ? 'MERGE' : 'COMBINE';
          console.log(`  [${label}] ${task} ${progress.completed}/${progress.total}${cached} ${duration}`);
        }
      },
      onUnitRequeued: (task, unit, requeue) => {
        console.log(`  [REQUEUE] ${task} ${formatRequeue(unit, requeue.reason, requeue.peak, requeue.reserves)}`);
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
      process.exitCode = 1;
    }
  } finally { await rack?.close(); }
}

// =============================================================================
// Remote Execution
// =============================================================================

interface RemoteExecuteOptions {
  /** The tasks the run forces: `true` for every task, or the tasks named */
  force?: true | readonly string[];
  filter?: string;
  verbose?: boolean;
}

async function executeRemote(
  baseUrl: string,
  repo: string,
  ws: string,
  options: RemoteExecuteOptions,
  isAborted: () => boolean
): Promise<void> {
  // Re-resolve the token before every request rather than pinning one for the
  // whole run: getValidToken refreshes it as it nears expiry, so a long dataflow
  // run never sends an expired token and dies mid-flight with "Token expired".

  // Start the dataflow execution, which the server runs under its own budget
  await dataflowExecuteLaunchRemote(baseUrl, repo, ws, {
    force: options.force,
    filter: options.filter,
  }, { token: await getValidToken(baseUrl), verbose: options.verbose });

  // Follow the run, each poll with the token as it stands then
  const ended = await followRemoteRun(
    async (since) => dataflowExecutePollRemote(baseUrl, repo, ws, { since }, { token: await getValidToken(baseUrl) }),
    isAborted,
  );
  const lastStatus: DataflowExecutionState['status']['type'] | null = ended?.status.type ?? null;
  if (ended !== null) {
    // Print summary if available
    if (ended.summary.type === 'some') {
      const summary = ended.summary.value;
      printSummary({
        executed: Number(summary.executed),
        cached: Number(summary.cached),
        failed: Number(summary.failed),
        skipped: Number(summary.skipped),
        duration: summary.duration,
      });
    }

    if (lastStatus === 'completed') {
      await printOutputs({ type: 'remote', baseUrl, repo, token: await getValidToken(baseUrl) }, ws);
    }
  }

  // Handle abort
  if (isAborted()) {
    console.log('');
    // Tell the server to stop the run and release the workspace lock. Ctrl-C
    // only aborts the client's poll loop — without this the server keeps
    // executing and the workspace stays locked, blocking the next deploy/run.
    try {
      await dataflowCancelRemote(baseUrl, repo, ws, { token: await getValidToken(baseUrl) });
    } catch {
      console.log('Warning: could not reach the server to cancel — the run may still be executing.');
    }
    console.log('Aborted.');
    process.exit(130);
  }

  // Exit with error if execution failed
  if (lastStatus === 'failed') {
    process.exit(1);
  }
}

/**
 * Follows a remote run until it ends, printing each event as a poll serves it.
 *
 * @remarks
 * Each poll is from the cursor the last answered. A poll is served at most
 * 1,000 events, so one that left some is followed at once, and the run's end
 * is taken only once its events are all printed. A poll that served nothing
 * past its cursor counts as caught up, whatever the summary names, so a store
 * whose summary runs ahead of its events is not polled in a tight loop.
 *
 * @param poll - Polls the run from a cursor
 * @param isAborted - Whether the caller has stopped following
 * @param wait - Waits between polls that left no event to read
 * @returns The state the run ended with, or `null` when aborted first
 */
export async function followRemoteRun(
  poll: (since: bigint) => Promise<DataflowExecutionState>,
  isAborted: () => boolean,
  wait: () => Promise<void> = () => sleep(POLL_INTERVAL),
): Promise<DataflowExecutionState | null> {
  let since = 0n;
  while (!isAborted()) {
    const state = await poll(since);
    for (const event of state.events) {
      printEvent(event);
    }
    const moved = seqBefore(since, state.nextSeq);
    since = state.nextSeq;
    if (moved && dataflowEventsRemain(state)) continue;
    if (state.status.type !== 'running') return state;
    await wait();
  }
  return null;
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
    case 'requeued':
      console.log(`  [REQUEUE] ${event.value.task} ${formatRequeue(event.value.unit, event.value.reason.type, Number(event.value.peak), Number(event.value.reserves))}`);
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
    case 'cancelled':
      console.log(`  [CANCELLED] ${result.name}`);
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
  // Stderr, not stdout — `e3 dataflow run` exits non-zero in this branch,
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
