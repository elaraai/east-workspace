/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The roots gc marks from, read through a backend's ref stores: what each
 * package, deployed workspace and execution a repository records names.
 *
 * A `RepoStore` serves its gc root scans from these, or from a scan of its own
 * that finds the same roots.
 */

import { decodeBeast2For } from '@elaraai/east';
import { WorkspaceRecordType, executionStatusRoots } from '@elaraai/e3-types';
import { refPathToKeypath } from './dataset-refs.js';
import type { DatasetRefStore, RefStore } from './storage/interfaces.js';

/**
 * The package object each package ref names.
 *
 * @param refs - The backend's ref store
 * @param repo - Repository identifier
 * @returns The package objects' hashes
 */
export async function packageRoots(refs: RefStore, repo: string): Promise<string[]> {
  const roots: string[] = [];
  for (const { name, version } of await refs.packageList(repo)) {
    const hash = await refs.packageResolve(repo, name, version);
    if (hash !== null) roots.push(hash);
  }
  return roots;
}

/**
 * What each deployed workspace names: its package object, and the value and
 * the history of each of its datasets.
 *
 * @param refs - The backend's ref store
 * @param datasets - The backend's dataset ref store
 * @param repo - Repository identifier
 * @returns The roots' hashes
 */
export async function workspaceRoots(refs: RefStore, datasets: DatasetRefStore, repo: string): Promise<string[]> {
  const roots: string[] = [];
  const decoder = decodeBeast2For(WorkspaceRecordType);
  for (const name of await refs.workspaceList(repo)) {
    const data = await refs.workspaceRead(repo, name);
    if (data === null) continue;
    try {
      const record = decoder(data);
      if (record.type === 'none') continue; // not deployed
      roots.push(record.value.packageHash);
      for (const refPath of await datasets.list(repo, name)) {
        const ref = await datasets.read(repo, name, refPath);
        if (ref === null || ref.type !== 'value') continue;
        roots.push(ref.value.hash);
        // Root the version-vector SELF-entry only — a record's head-commit
        // hash (its history root). For plain values the self-entry equals
        // the state hash already rooted above (harmless dupe); a derived
        // dataset has no self-entry, so its inputs' hashes are not rooted
        // here (they stay alive via those inputs' own refs).
        const selfEntry = ref.value.versions.get(refPathToKeypath(refPath));
        if (selfEntry !== undefined) roots.push(selfEntry);
      }
    } catch {
      // Corrupt workspace state - skip
    }
  }
  return roots;
}

/**
 * What each execution the repository records names: each attempt's roots, and
 * the plan a split task's execution that can resume is in.
 *
 * @param refs - The backend's ref store
 * @param repo - Repository identifier
 * @returns The roots' hashes
 */
export async function executionRoots(refs: RefStore, repo: string): Promise<string[]> {
  const roots: string[] = [];
  for (const { taskHash, inputsHash } of await refs.executionList(repo)) {
    // The plan of a split task's execution that can resume: the `$plan` of
    // the stage it is in. It is the only reference to the pieces it cut and
    // the key ranges it planned, and it lives in a record no other scan
    // reads — unrooted, the sweep takes the plan and everything it records,
    // and a resumed run plans again from scratch. gc walks the plan itself,
    // by its kind tag.
    const planHash = await refs.executionPlanRead(repo, taskHash, inputsHash);
    if (planHash !== null) roots.push(planHash);
    for (const executionId of await refs.executionListIds(repo, taskHash, inputsHash)) {
      const status = await refs.executionGet(repo, taskHash, inputsHash, executionId);
      if (status !== null) roots.push(...executionStatusRoots(status));
    }
  }
  return roots;
}
