/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The cut of a selection: a package holding only a list of tasks, and the
 * datasets those tasks read that none of them writes, the selection's edge.
 *
 * A replica's dataflow builds its graph from its whole package, so a replica
 * given the origin's package would try to run tasks it has no inputs for. A
 * partial replica is given a package of its own instead: the origin's tasks
 * it was selected for, each by the hash the origin's package names it by, so
 * a task's hash, and every execution's identity, stays the origin's. A task
 * of the cut that reads a dataset no task of the cut writes reads it as a
 * root input, which the replica is given as a value.
 *
 * Pure: it reads no store.
 */

import type { PackageObject, SyncSelection } from '@elaraai/e3-types';
import type { DataflowGraph } from '../dataflow.js';
import { SyncSelectionError } from '../errors.js';

/**
 * What a selection cuts from a package.
 */
export interface SelectionCut {
  /** The replica's package: the selection's tasks, the whole structure, and
   *  no refs, functions, records or sources */
  readonly package: PackageObject;
  /** The selection's tasks in the graph's order, each depending only on the
   *  tasks of the cut it depended on */
  readonly tasks: DataflowGraph['tasks'];
  /** Keypaths a task of the cut reads and none writes, sorted */
  readonly edge: readonly string[];
  /** Keypaths the cut's tasks write, sorted */
  readonly outputs: readonly string[];
}

/**
 * Cuts a selection from a package.
 *
 * @param pkg - The origin workspace's package
 * @param graph - The origin workspace's graph (`dataflowGetGraph`)
 * @param selection - The tasks to cut
 * @returns The cut
 * @throws {SyncSelectionError} When the selection is the whole workspace,
 *   which a workspace bundle carries; when it names bindings or records,
 *   which are not supported yet; when it names a task the package does not
 *   have, naming each; or when it leaves out a task between two of its own,
 *   naming each, since a task of the cut would then read what that task made
 *   from the origin's values, not the cut's
 *
 * @example
 * ```ts
 * const cut = selectionCut(pkg, graph, variant('partial', {
 *   tasks: ['second'], binds: { paths: [], functions: [], records: [], pages: [] }, records: [],
 * }));
 * cut.edge; // ['.tasks.first.output']
 * ```
 */
export function selectionCut(pkg: PackageObject, graph: DataflowGraph, selection: SyncSelection): SelectionCut {
  if (selection.type === 'full') throw new SyncSelectionError('a full selection is the workspace bundle\'s');
  const { tasks: named, binds, records } = selection.value;
  if (binds.paths.length > 0 || binds.functions.length > 0 || binds.records.length > 0 || binds.pages.length > 0 || records.length > 0) {
    throw new SyncSelectionError('bindings are not supported yet');
  }
  const wanted = new Set(named);
  const unknown = [...wanted].filter((name) => !pkg.tasks.has(name)).sort();
  if (unknown.length > 0) {
    throw new SyncSelectionError(`the package has no task ${unknown.map((name) => `'${name}'`).join(', ')}`);
  }

  const tasks = graph.tasks
    .filter((task) => wanted.has(task.name))
    .map((task) => ({ ...task, inputs: [...task.inputs], dependsOn: task.dependsOn.filter((dep) => wanted.has(dep)) }));
  const outputs = new Set(tasks.map((task) => task.output));
  const edge = new Set<string>();
  for (const task of tasks) {
    for (const input of task.inputs) if (!outputs.has(input)) edge.add(input);
  }

  // A task outside the cut that depends, however far back, on a task of it,
  // and writes what a task of it reads, is between two of its tasks
  const byName = new Map(graph.tasks.map((task) => [task.name, task]));
  const reaches = new Map<string, boolean>();
  const belowCut = (name: string): boolean => {
    const known = reaches.get(name);
    if (known !== undefined) return known;
    const below = (byName.get(name)?.dependsOn ?? []).some((dep) => wanted.has(dep) || belowCut(dep));
    reaches.set(name, below);
    return below;
  };
  const between = graph.tasks
    .filter((task) => !wanted.has(task.name) && edge.has(task.output) && belowCut(task.name))
    .map((task) => `'${task.name}'`);
  if (between.length > 0) {
    throw new SyncSelectionError(`the selection leaves out ${between.join(', ')}, between tasks it holds`);
  }

  return {
    package: {
      tasks: new Map([...pkg.tasks].filter(([name]) => wanted.has(name))),
      // The whole structure, so every path the origin declares stays declared
      data: { structure: pkg.data.structure, refs: new Map() },
      functions: new Map(),
      records: new Map(),
      sources: new Map(),
    },
    tasks,
    edge: [...edge].sort(),
    outputs: [...outputs].sort(),
  };
}
