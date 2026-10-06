/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a deploy does to a workspace's inputs: the plan it makes for each
 * before it writes anything.
 *
 * An input is a dataset its package marks writable, which people set. A
 * deploy gives each the new package's value, as it always has, unless someone
 * set it: the workspace holds a value other than the one the deployed package
 * gave it. Under `reset` such an input takes the new package's value too, and
 * the plan says it was reset; under `keep-edited` it is kept while its type is
 * the new package's. An input the new package takes from a file takes its
 * file, and one the new package does not declare goes.
 *
 * An input the deployed package took from a file holds the file's value, or
 * one someone set since, and nothing tells the two apart: so where the new
 * package gives it a value of its own, it takes that value under either
 * policy, and the plan says it was reset, and why. So does an input someone
 * set that the new package declares as a dataset people do not set.
 *
 * @packageDocumentation
 */

import { isTypeValueEqual, variant, type EastTypeValue } from '@elaraai/east';
import type { DatasetRef, InputPlan, InputPolicy, PackageObject, Structure } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import { typeChange } from './record-deploy.js';
import type { StorageBackend } from './storage/interfaces.js';

/** What a deploy does to one input, and the ref it keeps. */
export interface InputDeployment {
  /** What the deploy decided. */
  plan: InputPlan;
  /** The ref the workspace holds, for an input the deploy keeps. */
  kept?: DatasetRef;
}

/** Why a deploy under `reset` gives an input someone set the package's value. */
const RESET_BY_POLICY = 'was set in the workspace, and this deploy resets the inputs people set: the keep-edited policy keeps it';

/** Why a deploy gives an input the deployed package took from a file the new
 *  package's value, whatever its policy. */
const RESET_FROM_FILE = 'took its value from a file under the deployed package, and a value set since cannot be told from the file\'s';

/** Why a deploy gives an input someone set the new package's value when the
 *  new package declares it as a dataset people do not set. */
const RESET_NO_LONGER_INPUT = 'is no longer an input of the new package, which gives it its value';

/**
 * The inputs a package's structure declares: each dataset it marks writable,
 * which people set, by its ref path, with its type, in the structure's order.
 *
 * @param structure - The package's data structure
 * @returns Ref path -> the input's type
 */
export function structureInputs(structure: Structure): Map<string, EastTypeValue> {
  const inputs = new Map<string, EastTypeValue>();
  for (const [path, { type, writable }] of structureDatasets(structure)) {
    if (writable) inputs.set(path, type);
  }
  return inputs;
}

/** Every dataset a package's structure declares, by its ref path, in the
 *  structure's order: its type, and whether people set it. */
function structureDatasets(structure: Structure): Map<string, { type: EastTypeValue; writable: boolean }> {
  const datasets = new Map<string, { type: EastTypeValue; writable: boolean }>();
  const walk = (node: Structure, prefix: string): void => {
    if (node.type === 'value') {
      datasets.set(prefix, { type: node.value.type, writable: node.value.writable });
      return;
    }
    for (const [field, child] of node.value) walk(child, prefix === '' ? field : `${prefix}/${field}`);
  };
  walk(structure, '');
  return datasets;
}

/** Whether two refs hold one value: both unassigned, both null, or the same
 *  object. Their version vectors say where a value came from, not what it is. */
function sameValue(held: DatasetRef, given: DatasetRef): boolean {
  if (held.type === 'value' && given.type === 'value') return held.value.hash === given.value.hash;
  return held.type === given.type;
}

/** What the workspace holds of an input the deployed package declares,
 *  against the value that package gave it. */
type Held =
  /** The value the deployed package gave it, or none. */
  | { kind: 'package' }
  /** A value someone set: the ref the workspace holds. */
  | { kind: 'set'; ref: DatasetRef }
  /** A value of the file the deployed package took it from, or one someone
   *  set since: nothing tells the two apart. */
  | { kind: 'file' };

/**
 * What the workspace holds of an input the deployed package declares.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param prior - The package the workspace has deployed, which declares the
 *   input
 * @param input - The input's ref path
 * @returns `package` when the workspace holds the package's value or none;
 *   `set`, with the ref it holds, when someone set it; `file` when it holds a
 *   value and the package took the input from a file
 */
async function heldValue(
  storage: StorageBackend,
  repo: string,
  ws: string,
  prior: PackageObject,
  input: string,
): Promise<Held> {
  const held = await storage.datasets.read(repo, ws, input);
  if (held === null || held.type === 'unassigned') return { kind: 'package' };
  if (prior.sources.has(input)) return { kind: 'file' };
  return sameValue(held, prior.data.refs.get(input) ?? variant('unassigned', null)) ? { kind: 'package' } : { kind: 'set', ref: held };
}

/**
 * Decide what a deploy does to each input, before it writes anything.
 *
 * @remarks
 * For an input the new package declares:
 * - the new package takes it from a file: `file`, as every deploy does,
 *   `taken` when this deploy reads its file;
 * - the workspace holds the value the deployed package gave it, or does not
 *   hold the input: `package`;
 * - the deployed package took it from a file, and the workspace holds a
 *   value: `reset`, under either policy, since a value set since cannot be
 *   told from the file's;
 * - someone set it, and its type changed: `reset`, under either policy;
 * - someone set it, under `reset`: `reset`, its `policy` true, since
 *   `keep-edited` would keep it;
 * - someone set it, under `keep-edited`: `keep`.
 *
 * An input the deployed package declares and the new one does not is
 * dropped. One the new package declares as a dataset people do not set takes
 * the new package's value: `package`, or `reset` when the workspace may hold
 * a value someone set.
 *
 * The workspace's refs are read a few at a time, and only those of the inputs
 * the deployed package declares that the new one does not take from a file.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param pkg - The package being deployed
 * @param prior - The package the workspace has deployed, or null when it has
 *   none
 * @param policy - What to do with an input someone set
 * @param resolveFileSources - Whether this deploy reads the new package's
 *   `file` sources; one that does not leaves each unassigned, for its client
 *   to complete
 * @returns One deployment per input: the new package's, in its structure's
 *   order, and then each the deployed package declares that the new one does
 *   not, in that package's
 */
export async function planInputDeployments(
  storage: StorageBackend,
  repo: string,
  ws: string,
  pkg: PackageObject,
  prior: PackageObject | null,
  policy: InputPolicy,
  resolveFileSources = true,
): Promise<InputDeployment[]> {
  const declared = structureInputs(pkg.data.structure);
  const datasets = structureDatasets(pkg.data.structure);
  const before = prior === null ? new Map<string, EastTypeValue>() : structureInputs(prior.data.structure);
  const held = new Map<string, Held>();
  if (prior !== null) {
    const asked = [...before.keys()].filter((input) => datasets.has(input) && !pkg.sources.has(input));
    await eachAtMost(asked, OBJECT_CONCURRENCY, async (input) => {
      held.set(input, await heldValue(storage, repo, ws, prior, input));
    });
  }
  const file = (input: string, path: string): InputDeployment =>
    ({ plan: { input, action: variant('file', { path, taken: resolveFileSources }) } });
  const reset = (input: string, reason: string, byPolicy = false): InputDeployment =>
    ({ plan: { input, action: variant('reset', { reason, policy: byPolicy }) } });

  const deployments: InputDeployment[] = [];
  for (const [input, type] of declared) {
    const source = pkg.sources.get(input);
    const was = before.get(input);
    const value = held.get(input);
    if (source !== undefined) {
      deployments.push(file(input, source.value.path));
    } else if (was === undefined || value === undefined || value.kind === 'package') {
      deployments.push({ plan: { input, action: variant('package', null) } });
    } else if (value.kind === 'file') {
      deployments.push(reset(input, RESET_FROM_FILE));
    } else if (!isTypeValueEqual(was, type)) {
      deployments.push(reset(input, `was set in the workspace, and changed type:\n${typeChange(was, type).replace(/^/gm, '    ')}`));
    } else if (policy === 'reset') {
      deployments.push(reset(input, RESET_BY_POLICY, true));
    } else {
      deployments.push({ plan: { input, action: variant('keep', null) }, kept: value.ref });
    }
  }
  for (const input of before.keys()) {
    if (declared.has(input)) continue;
    const source = pkg.sources.get(input);
    const value = held.get(input);
    if (!datasets.has(input)) {
      deployments.push({ plan: { input, action: variant('drop', null) } });
    } else if (source !== undefined) {
      deployments.push(file(input, source.value.path));
    } else if (value === undefined || value.kind === 'package') {
      deployments.push({ plan: { input, action: variant('package', null) } });
    } else {
      deployments.push(reset(input, RESET_NO_LONGER_INPUT));
    }
  }
  return deployments;
}

/**
 * The refs a deploy writes: the package's, with each input it keeps holding
 * the ref the workspace holds.
 *
 * @param refs - The package's refs, by ref path
 * @param inputs - What the deploy decided for each input
 * @returns The refs to write
 */
export function refsKeepingInputs(
  refs: ReadonlyMap<string, DatasetRef>,
  inputs: readonly InputDeployment[],
): Map<string, DatasetRef> {
  const written = new Map(refs);
  for (const { plan, kept } of inputs) {
    if (kept !== undefined) written.set(plan.input, kept);
  }
  return written;
}
