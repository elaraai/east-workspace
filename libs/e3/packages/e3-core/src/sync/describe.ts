/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A selection of a workspace, described: what a replica is made from.
 *
 * A description holds the replica's package as a value ({@link selectionCut}),
 * the ref of each dataset on the selection's edge, and the e3 release that
 * wrote it. An edge dataset's ref carries the version vector the origin's
 * loop gives it: a root input's own entry, which for a record names its head
 * commit, and a task's output the root inputs it was made from. A record on
 * the edge is described by its state, which names its primary and its
 * indexes; the replica neither holds nor needs the commit its entry names.
 * The selection's outputs are not described: a replica's own run writes them.
 *
 * A replica's loop takes its edge for root inputs, so it cannot tell that two
 * of them were made from two values of one input. The origin's run would make
 * the older one again first; a replica's cannot, so such a selection is
 * refused.
 */

import { variant } from '@elaraai/east';
import { E3_RELEASE, type DatasetRef, type SyncDescription, type SyncSelection, type VersionVector } from '@elaraai/e3-types';
import { dataflowGetGraph } from '../dataflow.js';
import { checkVersionConsistency, inputVersionVector, keypathToRefPath } from '../dataset-refs.js';
import { SyncSelectionError, WorkspaceLockError, checkHash, checkName, lockStateToHolderInfo } from '../errors.js';
import { packageObjectRead } from '../packages.js';
import { withRunningWork } from '../running-work.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { readStateOrThrow } from '../workspaces.js';
import { selectionCut } from './selection.js';

/**
 * Options for {@link syncDescribe}.
 */
export interface SyncDescribeOptions {
  /**
   * Values to describe edge datasets by, in place of their refs': keypath to
   * object hash, such as the outputs the execution cache will answer tasks
   * with. A value a ref does not hold is given the version vector the
   * origin's loop gives the output it is: its task's inputs' vectors,
   * merged, each input's given value or its ref's. A keypath on no edge is
   * consulted only as such an input.
   */
  readonly values?: ReadonlyMap<string, string>;
}

/**
 * Describes a selection of a workspace.
 *
 * Holds the workspace's lock shared, as a bundle's export does, for the read
 * alone: what a replica fetches afterwards is the replica's to fetch.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param selection - The tasks to describe
 * @param options - Values to describe edge datasets by
 * @returns The description
 * @throws {InvalidNameError} When `ws` is no workspace's name, or a value
 *   given is not an object hash
 * @throws {WorkspaceNotFoundError} When the workspace does not exist
 * @throws {WorkspaceNotDeployedError} When no package is deployed to it
 * @throws {WorkspaceLockError} When something holds it exclusively
 * @throws {SyncSelectionError} When the selection cannot be cut, or a task of
 *   it would read values made from two values of one input, naming it
 *
 * @example
 * ```ts
 * const description = await syncDescribe(storage, repo, 'dev', variant('partial', {
 *   tasks: ['first', 'second'], binds: { paths: [], functions: [], records: [], pages: [] }, records: [],
 * }));
 * ```
 */
export async function syncDescribe(
  storage: StorageBackend,
  repo: string,
  ws: string,
  selection: SyncSelection,
  options: SyncDescribeOptions = {},
): Promise<SyncDescription> {
  checkName('workspace', ws);
  for (const hash of options.values?.values() ?? []) checkHash('object hash', hash);
  return withRunningWork(storage, repo, async () => {
    const lock = await storage.locks.acquire(repo, ws, variant('export', null), { mode: 'shared' });
    if (lock === null) {
      const state = await storage.locks.getState(repo, ws);
      throw new WorkspaceLockError(ws, state ? lockStateToHolderInfo(state) : undefined);
    }
    try {
      const state = await readStateOrThrow(storage, repo, ws);
      const pkg = await packageObjectRead(storage, repo, state.packageHash);
      const graph = await dataflowGetGraph(storage, repo, ws);
      const cut = selectionCut(pkg, graph, selection);

      // Each keypath's version vector, as the origin's loop gives it. A root
      // input's is its own entry: its ref's, which for a record names its head
      // commit, or its value's hash. A task's output's is its ref's, or, for a
      // value given that its ref does not hold, its task's inputs' merged.
      const producers = new Map(graph.tasks.map((task) => [task.output, task]));
      const vectors = new Map<string, Promise<VersionVector>>();
      const vectorOf = (keypath: string): Promise<VersionVector> => {
        let vector = vectors.get(keypath);
        if (vector === undefined) {
          vector = (async (): Promise<VersionVector> => {
            const given = options.values?.get(keypath);
            const ref = await storage.datasets.read(repo, ws, keypathToRefPath(keypath));
            const producer = producers.get(keypath);
            if (producer === undefined) {
              const hash = given ?? (ref?.type === 'value' ? ref.value.hash : undefined);
              if (hash === undefined) return new Map();
              const own = given === undefined && ref?.type === 'value' ? ref.value.versions.get(keypath) : undefined;
              return inputVersionVector(keypath, own ?? hash);
            }
            const holds = ref !== null && ref.type !== 'unassigned' && (given === undefined || (ref.type === 'value' && ref.value.hash === given));
            if (holds) return ref.value.versions;
            if (given === undefined) return new Map();
            const merged = checkVersionConsistency(await Promise.all(producer.inputs.map(vectorOf)));
            if (!merged.consistent) {
              throw new SyncSelectionError(`the value given for '${keypath}' was made from two values of '${merged.conflictPath}'`);
            }
            return merged.merged;
          })();
          vectors.set(keypath, vector);
        }
        return vector;
      };

      // Each task of the cut reads values made from one value of each input,
      // what the cut writes as the replica's loop will make it
      const cutWrites = new Map(cut.tasks.map((task) => [task.output, task]));
      const made = new Map<string, Promise<VersionVector>>();
      const madeOf = (keypath: string): Promise<VersionVector> => {
        const task = cutWrites.get(keypath);
        if (task === undefined) return vectorOf(keypath);
        let vector = made.get(keypath);
        if (vector === undefined) {
          vector = (async (): Promise<VersionVector> => {
            const merged = checkVersionConsistency(await Promise.all(task.inputs.map(madeOf)));
            if (!merged.consistent) {
              throw new SyncSelectionError(`'${task.name}' would read values made from two values of '${merged.conflictPath}': the origin makes the older again first`);
            }
            return merged.merged;
          })();
          made.set(keypath, vector);
        }
        return vector;
      };
      for (const task of cut.tasks) await madeOf(task.output);

      const datasets = new Map<string, DatasetRef>();
      for (const keypath of cut.edge) {
        const refPath = keypathToRefPath(keypath);
        const given = options.values?.get(keypath);
        const ref = given !== undefined ? null : await storage.datasets.read(repo, ws, refPath);
        const hash = given ?? (ref?.type === 'value' ? ref.value.hash : undefined);
        if (hash !== undefined) {
          datasets.set(refPath, variant('value', { hash, versions: await vectorOf(keypath) }));
        } else if (ref?.type === 'null') {
          datasets.set(refPath, variant('null', { versions: await vectorOf(keypath) }));
        } else {
          datasets.set(refPath, variant('unassigned', null));
        }
      }

      return {
        release: E3_RELEASE,
        origin: { name: state.packageName, version: state.packageVersion, hash: state.packageHash },
        package: cut.package,
        deployedAt: state.deployedAt,
        datasets,
        executions: [],
      };
    } finally {
      await lock.release();
    }
  });
}

/**
 * The objects a replica must hold before its refs are written: each task
 * object its package names, each value a dataset of it holds, and each
 * execution's output. Every other object a replica needs is reached from
 * these. They are not the origin's package, a record's commits, or a plan.
 *
 * @param description - The description
 * @returns The roots, each once, sorted
 *
 * @example
 * ```ts
 * const roots = descriptionRoots(await syncDescribe(storage, repo, 'dev', selection));
 * await touchReachable(storage, repo, roots); // every object a replica of it may read
 * ```
 */
export function descriptionRoots(description: SyncDescription): string[] {
  const roots = new Set<string>(description.package.tasks.values());
  for (const ref of description.datasets.values()) {
    if (ref.type === 'value') roots.add(ref.value.hash);
  }
  for (const { status } of description.executions) {
    if (status.type === 'success') roots.add(status.value.outputHash);
  }
  return [...roots].sort();
}
