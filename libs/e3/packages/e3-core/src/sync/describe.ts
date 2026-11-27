/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A selection of a workspace, described: what a replica is made from.
 *
 * A description holds the replica's package as a value ({@link selectionCut}),
 * the ref of each dataset on the selection's edge, and the e3 release that
 * wrote it. An edge dataset is a root input to the replica, so its ref names
 * its value alone: the value's hash, with a version vector of its self-entry
 * and nothing else. A record on the edge is described by its state, which
 * names its primary and its indexes and no commit, so a replica needs none of
 * its history. The selection's outputs are not described: a replica's own
 * run writes them.
 */

import { variant } from '@elaraai/east';
import { E3_RELEASE, type DatasetRef, type SyncDescription, type SyncSelection } from '@elaraai/e3-types';
import { dataflowGetGraph } from '../dataflow.js';
import { inputVersionVector, keypathToRefPath } from '../dataset-refs.js';
import { WorkspaceLockError, checkHash, checkName, lockStateToHolderInfo } from '../errors.js';
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
   * object hash. A keypath that is not on the edge is not consulted.
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
 * @throws {SyncSelectionError} When the selection cannot be cut
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

      const datasets = new Map<string, DatasetRef>();
      for (const keypath of cut.edge) {
        const refPath = keypathToRefPath(keypath);
        const given = options.values?.get(keypath);
        const ref = given !== undefined ? null : await storage.datasets.read(repo, ws, refPath);
        const hash = given ?? (ref?.type === 'value' ? ref.value.hash : undefined);
        if (hash !== undefined) {
          datasets.set(refPath, variant('value', { hash, versions: inputVersionVector(keypath, hash) }));
        } else if (ref?.type === 'null') {
          datasets.set(refPath, variant('null', { versions: new Map() }));
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
