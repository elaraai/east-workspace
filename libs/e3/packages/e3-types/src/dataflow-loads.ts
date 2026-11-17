/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The loads of a package's dataflow: each fed source of a composite record is
 * a step of a run, named `<record>.<source>`, that loads its feed into its
 * record. One place holds the rule for what such a step cannot run beside, so
 * the SDK refuses a package with the words the dataflow's graph refuses it with.
 */

import type { DataflowLoad } from './dataflow.js';

/**
 * The name a fed source's load has as a step of a run.
 *
 * @param record - The composite record's name
 * @param source - The source's name
 * @returns `<record>.<source>`
 *
 * @example
 * ```ts
 * loadNodeName('orders', 'erp');  // 'orders.erp'
 * ```
 */
export function loadNodeName(record: string, source: string): string {
  return `${record}.${source}`;
}

/**
 * A step of a package's dataflow, as the check for what a load cannot run
 * beside reads it: a task, or the load of a fed source.
 */
export interface DataflowStep {
  /** The keypaths of the datasets it reads: a load's feed alone. */
  readonly inputs: readonly string[];
  /** The keypath of the dataset it writes: a load's record. */
  readonly output: string;
  /** A task's name; undefined for a load. */
  readonly task?: string;
  /** A load's record and source; undefined for a task. */
  readonly load?: DataflowLoad;
}

/** A step from a dataset, by the words that name it, to the dataset it makes. */
interface MadeStep {
  readonly to: string;
  readonly words: readonly string[];
}

/**
 * Why a package's loads cannot run: a task named as a load is, its step in a
 * run, or a cycle through a load — what feeds the load reading the record the
 * load writes, directly or through other datasets, tasks and loads.
 *
 * @param steps - The package's tasks and loads, datasets named by keypath
 * @returns The words for the first problem found, a cycle naming each of its
 *   steps from the record back to it; null when there is none
 *
 * @example
 * ```ts
 * loadStepProblem([
 *   { task: 'extract', inputs: ['.records.orders'], output: '.tasks.extract.output' },
 *   { load: { record: 'orders', source: 'erp' }, inputs: ['.tasks.extract.output'], output: '.records.orders' },
 * ]);
 * // "a cycle through the load orders.erp — record 'orders' → task 'extract' → load orders.erp → record 'orders':
 * //  what feeds a load cannot read the record it loads"
 * ```
 */
export function loadStepProblem(steps: readonly DataflowStep[]): string | null {
  const tasks = new Set(steps.flatMap((step) => (step.task === undefined ? [] : [step.task])));
  for (const { load } of steps) {
    if (load !== undefined && tasks.has(loadNodeName(load.record, load.source))) {
      return `task '${loadNodeName(load.record, load.source)}' has the name of the load of source '${load.source}' of record '${load.record}', ` +
        'its step in a run — name the task otherwise';
    }
  }

  // Each dataset to the datasets made from it, each by the words for the steps that make it: a task's name, or a
  // load and the record it writes.
  const madeFrom = new Map<string, MadeStep[]>();
  for (const step of steps) {
    const words = step.load === undefined
      ? [`task '${step.task}'`]
      : [`load ${loadNodeName(step.load.record, step.load.source)}`, `record '${step.load.record}'`];
    for (const input of step.inputs) madeFrom.set(input, [...(madeFrom.get(input) ?? []), { to: step.output, words }]);
  }
  for (const step of steps) {
    if (step.load === undefined) continue;
    for (const feed of step.inputs) {
      const between = wordsBetween(madeFrom, step.output, feed);
      if (between === null) continue;
      const name = loadNodeName(step.load.record, step.load.source);
      const cycle = [`record '${step.load.record}'`, ...between, `load ${name}`, `record '${step.load.record}'`];
      return `a cycle through the load ${name} — ${cycle.join(' → ')}: what feeds a load cannot read the record it loads`;
    }
  }
  return null;
}

/**
 * The words for the fewest steps that make one dataset from another, found
 * breadth first.
 *
 * @param madeFrom - Each dataset to the steps made from it, by keypath
 * @param from - The dataset to start from
 * @param to - The dataset to reach
 * @returns The words, none when the two are one dataset; null when nothing made from the first reaches the second
 */
function wordsBetween(madeFrom: ReadonlyMap<string, readonly MadeStep[]>, from: string, to: string): string[] | null {
  const reached = new Map<string, readonly string[]>([[from, []]]);
  const queue = [from];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    const words = reached.get(at)!;
    if (at === to) return [...words];
    for (const next of madeFrom.get(at) ?? []) {
      if (reached.has(next.to)) continue;
      reached.set(next.to, [...words, ...next.words]);
      queue.push(next.to);
    }
  }
  return null;
}
