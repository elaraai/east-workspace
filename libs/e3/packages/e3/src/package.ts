/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Package definitions for e3.
 */

import type {
  FunctionDef,
  MutationDef,
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
 *
 * @example
 * ```ts
 * const input_name = e3.input('name', StringType, 'World');
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
  ...items: (PackageItem | FunctionDef | MutationDef | PackageDef<any>)[]
): PackageDef<Record<string, unknown>> {
  // Recursively collect all items and their transitive dependencies
  const all_items = new Set<PackageItem>();
  const visited = new Set<PackageItem>();
  // Functions have no deps and never enter the data tree — collected by
  // name, separately from all_items.
  const functions: Record<string, FunctionDef> = {};
  // Mutations are collected by owning record name, like functions; they are
  // folded onto their record below. Records themselves are datasets, so they
  // ride `all_items` and only need a separate RecordObject channel.
  const mutationsByRecord = new Map<string, Record<string, MutationDef>>();
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
    } else if (item.kind === "mutation") {
      // Pull in the owning record's dataset and register the mutation onto it.
      collect(item.record);
      const muts = mutationsByRecord.get(item.record.name) ?? {};
      muts[item.name] = item;
      mutationsByRecord.set(item.record.name, muts);
    } else {
      collect(item);
    }
  }

  const datasets: Record<string, any> = {};
  const tasks: Record<string, TaskDef> = {};

  // all_items is in topological order by construction
  for (const item of all_items) {
    if (item.kind === 'datatree') {
      let current = datasets;
      for (let i = 0; i < item.path.length - 1; i++) { // TODO should this path be the parent path?
        const segment = item.path[i];
        if (segment.type === 'field') {
          current = current[segment.value];
          if (current === undefined) {
            throw new Error(`Parent tree not found in package(): ${segment.value}`);
          }
        } else {
          throw new Error(`Unsupported path segment type in package(): ${segment.type satisfies never}`);
        }
      }

      // the only tree type is struct for now
      current[item.name] = {};
    } else if (item.kind === 'dataset') {
      let current = datasets;
      for (let i = 0; i < item.path.length - 1; i++) { // TODO should this path be the parent path?
        const segment = item.path[i];
        if (segment.type === 'field') {
          current = current[segment.value];
          if (current === undefined) {
            throw new Error(`Parent tree not found in package(): ${segment.value}`);
          }
        } else {
          throw new Error(`Unsupported path segment type in package(): ${segment.type satisfies never}`);
        }
      }

      current[item.name] = item;
    } else if (item.kind === 'task') {
      // TODO - check task inputs and output exist with correct types?
      tasks[item.name] = item;
    }
  }

  // Assemble records: a record's dataset rides `all_items`; fold in any
  // mutations collected for it.
  const records: Record<string, RecordDef> = { ...importedRecords };
  for (const item of all_items) {
    if (item.kind === 'dataset' && 'recordKind' in item && (item as RecordDef).recordKind === 'record') {
      const rec = item as RecordDef;
      records[rec.name] = { ...rec, mutations: { ...rec.mutations, ...mutationsByRecord.get(rec.name) } };
    }
  }
  for (const recName of mutationsByRecord.keys()) {
    if (!records[recName]) {
      throw new Error(`Mutation references record '${recName}' which is not in the package`);
    }
  }

  return {
    kind: 'package',
    name,
    version,
    datasets: datasets as any,
    contents: [...all_items],
    functions,
    records,
  };
}
