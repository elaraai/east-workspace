/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Package definitions for e3.
 */

import { printType } from '@elaraai/east';
import { nameProblem } from '@elaraai/e3-types';
import type {
  FunctionDef,
  MigrationDef,
  MutationDef,
  RecordIndexDef,
  PackageDef,
  PackageItem,
  RecordDef,
  TaskDef,
} from './types.js';
import { sameEastType } from './record-guards.js';

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
 *   repository keeps the package at `packages/<name>/<version>` — when a
 *   record is given two different mutations, indexes or migrations of one
 *   name, or when a record's migrations are not one chain that leaves it as
 *   its declared type
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
  ...items: (PackageItem | FunctionDef | MutationDef | RecordIndexDef | MigrationDef | PackageDef<any>)[]
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
  // Mutations are collected by owning record name, like functions; they are
  // folded onto their record below. Records themselves are datasets, so they
  // ride `all_items` and only need a separate RecordObject channel.
  const mutationsByRecord = new Map<string, MutationDef[]>();
  // Indexes are collected onto their record the same way, and for the same
  // reason: an index is declared beside the record and belongs to it.
  const indexesByRecord = new Map<string, RecordIndexDef[]>();
  // Migrations are collected onto their record too, each with the steps before
  // it, which its `after` names: passing a chain's last step passes the chain.
  const migrationsByRecord = new Map<string, MigrationDef[]>();
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
      mutationsByRecord.set(item.record.name, [...(mutationsByRecord.get(item.record.name) ?? []), item]);
    } else if (item.kind === "recordIndex") {
      collect(item.record);
      indexesByRecord.set(item.record.name, [...(indexesByRecord.get(item.record.name) ?? []), item]);
    } else if (item.kind === "migration") {
      collect(item.record);
      const steps = migrationsByRecord.get(item.record.name) ?? [];
      for (let step: MigrationDef | undefined = item; step !== undefined; step = step.after) steps.push(step);
      migrationsByRecord.set(item.record.name, steps);
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

  // One declaration per name on a record: given two different mutations, or
  // two different indexes, under one name, the record would keep whichever
  // came last.
  const byName = <D extends { name: string }>(record: string, kind: string, defs: D[]): Record<string, D> => {
    const named: Record<string, D> = {};
    for (const def of defs) {
      const taken = named[def.name];
      if (taken !== undefined && taken !== def) {
        throw new Error(`e3.package '${name}': record '${record}' declares two ${kind} named '${def.name}' — pass each declaration once`);
      }
      named[def.name] = def;
    }
    return named;
  };

  // A record's migrations in the order they run. They are one chain: exactly
  // one step has no `after`, no two name the same one, and the last leaves the
  // record as it is declared, since a deploy leaves a migrated record at the
  // package's type.
  const chainOf = (rec: RecordDef, steps: MigrationDef[]): MigrationDef[] => {
    const all = Object.values(byName(rec.name, 'migrations', steps));
    if (all.length === 0) return [];
    const where = `e3.package '${name}': record '${rec.name}'`;
    const firsts = all.filter((step) => step.after === undefined);
    if (firsts.length !== 1) {
      throw new Error(
        `${where} has ${firsts.length} migrations with no 'after' (${firsts.map((step) => `'${step.name}'`).join(', ')}) — ` +
        `its migrations are one chain, and only the first step names none`,
      );
    }
    const next = new Map<string, MigrationDef>();
    for (const step of all) {
      if (step.after === undefined) continue;
      const taken = next.get(step.after.name);
      if (taken !== undefined) {
        throw new Error(
          `${where} has two migrations after '${step.after.name}', '${taken.name}' and '${step.name}' — ` +
          `its migrations are one chain`,
        );
      }
      next.set(step.after.name, step);
    }
    const chain = [firsts[0]!];
    for (let step = next.get(firsts[0]!.name); step !== undefined; step = next.get(step.name)) chain.push(step);
    const last = chain[chain.length - 1]!;
    if (!sameEastType(last.to, rec.type)) {
      throw new Error(
        `${where} is declared as ${printType(rec.type)}, but its last migration, '${last.name}', ` +
        `leaves it as ${printType(last.to)}`,
      );
    }
    return chain;
  };

  // Assemble records: a record's dataset rides `all_items`; fold in any
  // mutations collected for it. A record imported via a package arrives twice —
  // its bare dataset (mutations `{}`) in `all_items` and its already-assembled
  // form in `importedRecords` — so merge the existing entry's mutations rather
  // than rebuilding from the bare `rec.mutations`, or the import's folded
  // mutations would be clobbered to empty.
  const records: Record<string, RecordDef> = { ...importedRecords };
  for (const item of all_items) {
    if (item.kind === 'dataset' && 'recordKind' in item && (item as RecordDef).recordKind === 'record') {
      const rec = item as RecordDef;
      records[rec.name] = {
        ...rec,
        mutations: byName(rec.name, 'mutations', [
          ...Object.values(records[rec.name]?.mutations ?? {}),
          ...Object.values(rec.mutations),
          ...(mutationsByRecord.get(rec.name) ?? []),
        ]),
        indexes: byName(rec.name, 'indexes', [
          ...Object.values(records[rec.name]?.indexes ?? {}),
          ...Object.values(rec.indexes),
          ...(indexesByRecord.get(rec.name) ?? []),
        ]),
        migrations: chainOf(rec, [
          ...(records[rec.name]?.migrations ?? []),
          ...rec.migrations,
          ...(migrationsByRecord.get(rec.name) ?? []),
        ]),
      };
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
