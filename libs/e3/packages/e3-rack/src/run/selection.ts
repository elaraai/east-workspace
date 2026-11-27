/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Which tasks of a run a rack runs whole, in one grant: those the run's cache
 * cannot answer, that the policy sends to a rack, and whose every input is
 * there before the run starts or made by another of them.
 */

import { dataflowGetGraph, dataflowPredict, type StorageBackend } from '@elaraai/e3-core';
import type { EligibilityEvaluator } from '../routing/eligibility.js';
import type { RackVerdict } from '../runner/rack-lease.js';

/** What a run grants a rack. */
export interface RackRunSelection {
  /** The tasks to grant, in the graph's order */
  readonly tasks: readonly string[];
  /** Each task the cache answers, by its output's keypath, and the output the
   *  cache answers it with: what the grant's edge reads */
  readonly values: ReadonlyMap<string, string>;
  /** Each granted task's verdict */
  readonly verdicts: ReadonlyMap<string, RackVerdict>;
}

/** What {@link rackRunSelection} decides by. */
export interface RackRunSelectionOptions {
  /** The run's policy's evaluator */
  readonly evaluator: EligibilityEvaluator;
  /** What the run forces */
  readonly force?: boolean | readonly string[];
  /** The run's filter */
  readonly filter?: string;
  /** Whether the run's processes are set to run with an environment, user
   *  or group of their own, which keeps every task here */
  readonly hostBound: boolean;
}

/**
 * Selects the tasks of a run a rack runs whole.
 *
 * @remarks
 * The run's prediction ({@link dataflowPredict}) says which tasks the cache
 * answers. Each other task is a candidate when the policy sends it to a rack
 * and nothing keeps it here: it is eligible, and declares no environment. In
 * dependency order, a candidate is selected when every task it depends on is
 * answered or selected: its inputs are then there before the run starts, or
 * made by the grant. Every other task runs as it would with no grant.
 *
 * @param storage - The repository's storage
 * @param repo - The repository
 * @param ws - The workspace
 * @param options - The evaluator, the run's force and filter, and whether its
 *   processes are bound to this host
 * @returns The selection: none when nothing is selected
 */
export async function rackRunSelection(storage: StorageBackend, repo: string, ws: string, options: RackRunSelectionOptions): Promise<RackRunSelection> {
  const prediction = await dataflowPredict(storage, repo, ws, {
    ...(options.force !== undefined && { force: options.force }),
    ...(options.filter !== undefined && { filter: options.filter }),
  });
  const graph = await dataflowGetGraph(storage, repo, ws);
  const byName = new Map(graph.tasks.map((task) => [task.name, task]));
  const values = new Map<string, string>();
  for (const [name, { outputHash }] of prediction.answered) values.set(byName.get(name)!.output, outputHash);
  const verdicts = new Map<string, RackVerdict>();
  if (options.hostBound) return { tasks: [], values, verdicts };

  const unanswered = new Set(prediction.unanswered);
  const decided = new Set<string>();
  const selected = new Set<string>();
  let left = graph.tasks.map((task) => task.name);
  while (left.length > 0) {
    const ready = left.filter((name) => byName.get(name)!.dependsOn.every((dep) => decided.has(dep) || !byName.has(dep)));
    if (ready.length === 0) break;
    for (const name of ready) {
      decided.add(name);
      if (!unanswered.has(name)) continue;
      const task = byName.get(name)!;
      if (!task.dependsOn.every((dep) => prediction.answered.has(dep) || selected.has(dep))) continue;
      const verdict = await options.evaluator.evaluateTask(storage, repo, task.hash, name);
      if (!verdict.eligible || verdict.environment !== null) continue;
      selected.add(name);
      verdicts.set(name, verdict);
    }
    left = left.filter((name) => !decided.has(name));
  }
  return { tasks: graph.tasks.map((task) => task.name).filter((name) => selected.has(name)), values, verdicts };
}
