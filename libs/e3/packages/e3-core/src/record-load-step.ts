/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A load found by the name it has as a step of a run.
 *
 * The load of a composite record's external source runs its task as a task's
 * runs: each run is an execution under the hash of the load's task object,
 * with its log. A dataflow names that step `<record>.<source>`
 * (`loadNodeName`), and that is the name a load's logs, runs and details are
 * read by, where a task's are read by the task's name. A source `e3 load`
 * delivers has no step of a run, and is found the same way: its load runs the
 * same task.
 */

import { decodeRecordLoadObject, loadNodeName, type DataflowLoad, type PackageObject, type RecordLoadObject } from '@elaraai/e3-types';
import { hashMemo, memoKey } from './memo.js';
import { recordOfPackage } from './records.js';
import type { StorageBackend } from './storage/interfaces.js';

/** How many decoded load objects {@link packageLoadStep} keeps. */
const LOAD_OBJECTS_KEPT = 1024;

/** What load objects decoded to, by repository and hash: a load's log is read each time a UI polls it. */
const loadObjects = hashMemo<RecordLoadObject>(LOAD_OBJECTS_KEPT);

/**
 * A load of a package, as a step of a run names it.
 */
export interface LoadStep {
  /** The record and source it loads */
  readonly load: DataflowLoad;
  /** The hash of its task object, which its executions are kept under */
  readonly task: string;
  /** The record's dataset ref path, such as `records/orders` */
  readonly refPath: string;
}

/**
 * Find the load of a package by the name it has as a step of a run.
 *
 * @remarks
 * Only a record whose name begins the step's is resolved, so a name that is
 * no load's costs no read, and a load's costs its record's object and its
 * load object, each read once and then from memory.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param pkg - The package, decoded
 * @param name - The step's name, `<record>.<source>`
 * @returns The load; `null` when the package declares no record and source of
 *   that name, or the source is one the record's mutations write
 *
 * @example
 * ```ts
 * const step = await packageLoadStep(storage, repo, pkg, 'orders.erp');
 * // { load: { record: 'orders', source: 'erp' }, task: '3fa2…', refPath: 'records/orders' }
 * ```
 */
export async function packageLoadStep(storage: StorageBackend, repo: string, pkg: PackageObject, name: string): Promise<LoadStep | null> {
  for (const record of pkg.records.keys()) {
    if (!name.startsWith(loadNodeName(record, ''))) continue;
    const resolved = await recordOfPackage(storage, repo, pkg, record);
    if (resolved === null) continue;
    for (const [source, writer] of resolved.sources) {
      if (writer.type !== 'load' || loadNodeName(record, source) !== name) continue;
      const key = memoKey(repo, writer.value);
      let load = loadObjects.get(key);
      if (load === undefined) {
        load = decodeRecordLoadObject(await storage.objects.read(repo, writer.value));
        loadObjects.set(key, load);
      }
      return { load: { record, source }, task: load.task, refPath: resolved.refPath };
    }
  }
  return null;
}
