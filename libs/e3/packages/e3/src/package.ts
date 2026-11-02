/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Package definitions for e3.
 */

import { nameProblem, pathToString } from '@elaraai/e3-types';
import type {
  DatasetDef,
  FunctionDef,
  PackageDef,
  PackageItem,
  RecordDef,
  TaskDef,
} from './types.js';

/**
 * Creates a package definition from items.
 *
 * Automatically collects all dependencies from the provided items.
 * You only need to pass the "top-level" items - all inputs, intermediate
 * tasks, and datasets they depend on are included automatically.
 *
 * Organizes items into a discoverable structure:
 * - `pkg.datasets.inputs.*` - Input datasets
 * - `pkg.datasets.outputs.*` - Output datasets
 * - `pkg.tasks.*` - Tasks
 *
 * @param name - Package name
 * @param version - Package version
 * @param items - Items to include (datasets, tasks)
 * @returns A PackageDef with typed access to contents
 * @throws {Error} When the name or the version cannot be a file name — a
 *   repository keeps the package at `packages/<name>/<version>` — or when given
 *   a record's index, mutation or migration apart from its record: a record is
 *   declared whole, its parts in `e3.record`, and a package takes the record
 *
 * @example
 * ```ts
 * const input_name = e3.input('name', StringType, variant('value', 'World'));
 * const say_hello = e3.task('say_hello', [input_name], ...);
 *
 * // Only need to pass the final task - input_name is included automatically
 * const pkg = e3.package('hello_world', '1.0.0', say_hello);
 *
 * // Typed access to contents
 * const nameInput = pkg.datasets.inputs.name;
 * const helloOutput = pkg.datasets.outputs.say_hello;
 * const helloTask = pkg.tasks.say_hello;
 * ```
 */
/** A package's datasets as a tree: under each name, a dataset or a tree of more. */
interface DatasetTree {
  [name: string]: DatasetTree | DatasetDef;
}

// NOTE: the return is deliberately `PackageDef<Record<string, unknown>>`, NOT
// `PackageDef<MergeDatasets<TItems>>`. The precise merged-datasets map (used only
// for the optional `pkg.datasets.tasks.x.output` typed-access convenience) inlines
// every task's full dataset type; with rich task outputs that map exceeds tsc's
// type-serialization limit, so `export default e3.package(...)` failed with TS7056
// and forced authors to hand-annotate. Access datasets via the exported
// task/input consts (`myTask.output`, `myInput.path`) instead — fully typed.
export function package_(
  name: string,
  version: string,
  ...items: (PackageItem | FunctionDef | PackageDef<Record<string, unknown>>)[]
): PackageDef<Record<string, unknown>> {
  for (const [kind, value] of [['package', name], ['package version', version]] as const) {
    const problem = nameProblem(kind, value);
    if (problem !== null) throw new Error(`e3.package: the ${kind} name ${JSON.stringify(value)} ${problem}`);
  }

  // Recursively collect all items and their transitive dependencies
  const all_items = new Set<PackageItem>();
  const visited = new Set<PackageItem>();
  // Functions have no deps and never enter the data tree — collected by
  // name, separately from all_items.
  const functions: Record<string, FunctionDef> = {};
  // Records are datasets, so they ride `all_items`, each whole with its parts;
  // an imported package's records arrive here as well.
  const importedRecords: Record<string, RecordDef> = {};

  function collect(item: PackageItem): void {
    if (visited.has(item)) return;
    visited.add(item);

    // First collect all dependencies recursively
    for (const dep of item.deps) {
      collect(dep);
    }

    // Then add this item (ensures topological order)
    all_items.add(item);
  }

  for (const item of items) {
    if (item.kind === "package") {
      for (const dep of item.contents) {
        all_items.add(dep);
      }
      Object.assign(functions, item.functions);
      Object.assign(importedRecords, item.records);
    } else if (item.kind === "function") {
      functions[item.name] = item;
    } else {
      refusePart(name, item);
      collect(item);
    }
  }

  // The package's datasets as a tree, each under its path's names; each tree
  // kept by its path too, the root's ''.
  const datasets: DatasetTree = {};
  const trees = new Map<string, DatasetTree>([['', datasets]]);
  const tasks: Record<string, TaskDef> = {};

  // all_items is in topological order by construction: a tree before what it holds
  for (const item of all_items) {
    if (item.kind === 'datatree' || item.kind === 'dataset') {
      const parentPath = pathToString(item.path.slice(0, -1));
      const parent = trees.get(parentPath);
      if (parent === undefined) {
        throw new Error(`Parent tree not found in package(): '${parentPath}'`);
      }
      if (item.kind === 'datatree') {
        // the only tree type is struct for now
        const tree: DatasetTree = {};
        parent[item.name] = tree;
        trees.set(pathToString(item.path), tree);
      } else {
        parent[item.name] = item;
      }
    } else if (item.kind === 'task') {
      // TODO - check task inputs and output exist with correct types?
      tasks[item.name] = item;
    }
  }

  // Each record whole, as `e3.record` declared it.
  const records: Record<string, RecordDef> = { ...importedRecords };
  for (const item of all_items) {
    if (item.kind === 'dataset' && 'recordKind' in item && (item as RecordDef).recordKind === 'record') {
      const rec = item as RecordDef;
      records[rec.name] = rec;
    }
  }

  return {
    kind: 'package',
    name,
    version,
    datasets,
    contents: [...all_items],
    functions,
    records,
  };
}

/** What each part of a record is called, by its kind. */
const PART_WORDS: Readonly<Record<string, string>> = { recordIndex: 'index', mutation: 'mutation', migration: 'migration' };

/**
 * Refuses a record's part given apart from its record, naming the record: its
 * parts are declared in `e3.record`, and a package takes the record whole.
 *
 * @param name - The package
 * @param item - What it was given
 * @throws {Error} When the item is an index, a mutation or a migration
 */
function refusePart(name: string, item: unknown): void {
  const part = item as { readonly kind: string; readonly name: string; readonly record?: { readonly name: string } };
  const words = PART_WORDS[part.kind];
  if (words === undefined) return;
  throw new Error(
    `e3.package '${name}': the ${words} '${part.name}' is part of record '${part.record?.name}' — a record is declared ` +
    `whole, its ${words === 'index' ? 'indexes' : `${words}s`} in e3.record, so pass the record`,
  );
}
