/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The history gc keeps: which of a repository's runs and executions it keeps,
 * and the deletion of the rest.
 *
 * gc keeps, of each workspace, its last `keepRuns` runs, every run from the
 * last `keepDays` days and the run its current state came from. It keeps every
 * execution those runs used, every execution a workspace's current state is
 * served from, every execution from the last `keepDays` days, and whatever is
 * running.
 * - A task over given inputs that keeps any execution keeps its latest attempt
 *   and its latest success, which are what the cache serves from: the dataflow
 *   is served the latest success, and a task run on its own the latest attempt
 *   when it succeeded. So gc never changes what either serves.
 * - A split task's kept success keeps the units its output was assembled from,
 *   which its last `$plan` names through the plans before it, and so does a
 *   kept split task's execution that can resume, through the plan it is in.
 *
 * It works through the storage interfaces, so it prunes any backend's history,
 * and it decides everything before it deletes anything.
 */

import { decodeBeast2For } from '@elaraai/east';
import { WorkspaceRecordType, decodeUnitPlan, executionStatusRoots, type ExecutionStatus, type UnitPlan } from '@elaraai/e3-types';
import type { StorageBackend } from '../interfaces.js';
import { dataflowGetGraph, dataflowResolveInputHashes, type DataflowGraph } from '../../dataflow.js';
import { inputsHash } from '../../executions.js';
import { stageUnits } from '../../execution/engine.js';
import { uuidv7Timestamp } from '../../uuid.js';

/** The runs of each workspace gc keeps however old: the latest ten. */
export const DEFAULT_KEEP_RUNS = 10;

/** The days of runs and executions gc keeps however many: a week. */
export const DEFAULT_KEEP_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What {@link pruneHistory} keeps, and whether it deletes the rest. */
export interface HistoryOptions {
  /** The runs of each workspace kept however old, the latest first. */
  keepRuns: number;
  /** The days of runs and executions kept however many. */
  keepDays: number;
  /** Whether to decide what goes without deleting it. */
  dryRun: boolean;
}

/** What {@link pruneHistory} deleted, or would delete, and what it kept. */
export interface HistoryResult {
  /** Run records deleted. */
  deletedRuns: number;
  /** Execution attempts deleted, each with its owner record and logs. */
  deletedExecutions: number;
  /** The objects the kept executions keep from the sweep: each kept success's
   *  output and last plan, and the plan each kept split task's execution is
   *  in. */
  roots: Set<string>;
}

/** A task over given inputs, and its attempts, oldest first. */
interface Identity {
  readonly taskHash: string;
  readonly inputsHash: string;
  /** Each attempt, with its record; `null` for one with none that reads. */
  readonly attempts: { readonly executionId: string; readonly status: ExecutionStatus | null }[];
  /** The `$plan` its split task's execution is in, when one is. */
  readonly plan: string | null;
}

/**
 * Deletes the runs and executions gc does not keep (see the module's doc).
 *
 * @remarks
 * Run under gc's locks, so no run or task writes a record while it decides.
 * Everything is decided before the first deletion, so a failure — a workspace
 * whose graph cannot be built — deletes nothing. An execution goes with its
 * owner record and its logs; a split task's plan pointer goes when nothing of
 * its execution is kept.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - What to keep, and whether to delete the rest
 * @param now - The time the ages are measured from, in epoch milliseconds
 * @returns What was deleted, or would be in a dry run, and the roots of what
 *   was kept
 */
export async function pruneHistory(
  storage: StorageBackend,
  repo: string,
  options: HistoryOptions,
  now: number = Date.now(),
): Promise<HistoryResult> {
  const cutoff = now - options.keepDays * DAY_MS;
  const recent = (id: string): boolean => uuidv7Timestamp(id).getTime() >= cutoff;
  const keyOf = (taskHash: string, inputs: string): string => `${taskHash}/${inputs}`;

  // Every task over given inputs the repository has run, with its attempts.
  const identities = new Map<string, Identity>();
  for (const { taskHash, inputsHash: inputs } of await storage.refs.executionList(repo)) {
    const attempts: { executionId: string; status: ExecutionStatus | null }[] = [];
    for (const executionId of await storage.refs.executionListIds(repo, taskHash, inputs)) {
      let status: ExecutionStatus | null;
      try {
        status = await storage.refs.executionGet(repo, taskHash, inputs, executionId);
      } catch {
        status = null; // A record that does not read keeps nothing
      }
      attempts.push({ executionId, status });
    }
    identities.set(keyOf(taskHash, inputs), {
      taskHash, inputsHash: inputs, attempts, plan: await storage.refs.executionPlanRead(repo, taskHash, inputs),
    });
  }

  const keptAttempts = new Set<string>();
  const keptIdentities = new Set<string>();
  // Kept identities whose own attempts and units are still to be kept.
  const pending: string[] = [];
  const keepIdentity = (key: string): void => {
    if (keptIdentities.has(key)) return;
    keptIdentities.add(key);
    pending.push(key);
  };
  const keepAttempt = (taskHash: string, inputs: string, executionId: string): void => {
    keptAttempts.add(`${keyOf(taskHash, inputs)}/${executionId}`);
    keepIdentity(keyOf(taskHash, inputs));
  };

  // The runs each workspace keeps, and the executions they used; and what
  // each workspace's current state is served from.
  const runsToDelete: { workspace: string; runId: string }[] = [];
  const decodeRecord = decodeBeast2For(WorkspaceRecordType);
  for (const workspace of await storage.refs.workspaceList(repo)) {
    const data = await storage.refs.workspaceRead(repo, workspace);
    const record = data === null ? null : decodeRecord(data);
    const state = record?.type === 'some' ? record.value : null;
    const runIds = await storage.refs.dataflowRunList(repo, workspace);
    const kept = new Set(options.keepRuns > 0 ? runIds.slice(-options.keepRuns) : []);
    if (state?.currentRunId.type === 'some') kept.add(state.currentRunId.value);
    for (const runId of runIds) {
      if (!kept.has(runId) && !recent(runId)) {
        runsToDelete.push({ workspace, runId });
        continue;
      }
      const run = await storage.refs.dataflowRunGet(repo, workspace, runId);
      for (const used of run?.taskExecutions.values() ?? []) keepAttempt(used.taskHash, used.inputsHash, used.executionId);
    }
    if (state === null) continue;
    let graph: DataflowGraph;
    try {
      graph = await dataflowGetGraph(storage, repo, workspace);
    } catch (err) {
      throw new Error(`gc deletes nothing while it cannot read what workspace '${workspace}' is served from: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const task of graph.tasks) {
      const inputs = await dataflowResolveInputHashes(storage, repo, workspace, task);
      const assigned = inputs.filter((hash): hash is string => hash !== null);
      if (assigned.length === inputs.length) keepIdentity(keyOf(task.hash, inputsHash(assigned)));
    }
  }

  // Every recent attempt, and whatever is running.
  for (const { taskHash, inputsHash: inputs, attempts } of identities.values()) {
    for (const { executionId, status } of attempts) {
      if (recent(executionId) || status?.type === 'running') keepAttempt(taskHash, inputs, executionId);
    }
  }

  // The units a split task's plans name, each plan once: the stage's, then
  // each stage's before it.
  const expanded = new Set<string>();
  const keepUnits = async (planHash: string): Promise<void> => {
    for (let next: string | null = planHash; next !== null && !expanded.has(next);) {
      expanded.add(next);
      let plan: UnitPlan;
      try {
        plan = decodeUnitPlan(await storage.objects.read(repo, next));
      } catch {
        return; // A plan that does not read names no units to keep
      }
      for (const unit of stageUnits(plan.stage)) keepIdentity(keyOf(plan.task, inputsHash(unit.inputs)));
      next = plan.previous.type === 'some' ? plan.previous.value : null;
    }
  };

  // Each kept identity keeps its latest attempt and its latest success, and a
  // split task's kept success, or its execution that can resume, keeps units.
  while (pending.length > 0) {
    const identity = identities.get(pending.pop()!);
    if (identity === undefined) continue; // Nothing recorded for it
    const { taskHash, inputsHash: inputs, attempts, plan } = identity;
    const latest = attempts.at(-1);
    if (latest !== undefined) keepAttempt(taskHash, inputs, latest.executionId);
    const success = [...attempts].reverse().find((attempt) => attempt.status?.type === 'success');
    if (success !== undefined) keepAttempt(taskHash, inputs, success.executionId);
    for (const { executionId, status } of attempts) {
      if (status?.type !== 'success' || status.value.plan.type !== 'some') continue;
      if (keptAttempts.has(`${keyOf(taskHash, inputs)}/${executionId}`)) await keepUnits(status.value.plan.value);
    }
    if (plan !== null) await keepUnits(plan);
  }

  // Everything else goes. Each identity's plan pointer goes first, then its
  // attempts, so the last attempt's deletion leaves its directory empty.
  const roots = new Set<string>();
  let deletedExecutions = 0;
  for (const [key, { taskHash, inputsHash: inputs, attempts, plan }] of identities) {
    if (plan !== null) {
      if (keptIdentities.has(key)) roots.add(plan);
      else if (!options.dryRun) await storage.refs.executionPlanWrite(repo, taskHash, inputs, null);
    }
    for (const { executionId, status } of attempts) {
      if (keptAttempts.has(`${key}/${executionId}`)) {
        if (status !== null) for (const root of executionStatusRoots(status)) roots.add(root);
        continue;
      }
      if (!options.dryRun) {
        await storage.logs.remove(repo, taskHash, inputs, executionId);
        await storage.refs.executionDelete(repo, taskHash, inputs, executionId);
      }
      deletedExecutions++;
    }
  }
  if (!options.dryRun) {
    for (const { workspace, runId } of runsToDelete) await storage.refs.dataflowRunDelete(repo, workspace, runId);
  }

  return { deletedRuns: runsToDelete.length, deletedExecutions, roots };
}
