/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a deploy does to a workspace's records: the plan it makes for each
 * before it writes anything, and the migrations it runs.
 *
 * A package declares the migrations that carry a record from one type, or one
 * set of values, to the next. A workspace records the ones its state has had
 * applied, by name, in the `$schema` slot of the record's ref. A deploy
 * compares the two. A record the workspace does not hold is minted; one at
 * the end of the package's chain is kept; one partway along it is migrated
 * by the steps it has not applied; anything else is refused, or reset under
 * the `reset` policy. The steps run as tasks before the deploy writes a ref,
 * so one that fails leaves the workspace as it was, and a deploy run again is
 * served the steps that finished from the execution cache.
 *
 * @packageDocumentation
 */

import {
  EastTypeType, diffTypeValues, encodeBeast2For, equalFor, none, printTypeValueSummary, renderTypeDiff, some, variant,
  type EastTypeValue,
} from '@elaraai/east';
import {
  TASK_OBJECT_KIND, TaskObjectType, decodeMigrationObject, decodeRecordObject,
  type MigrationObject, type PackageObject, type Structure, type TaskOutputKind,
} from '@elaraai/e3-types';
import { appliedMigrations, readRecordState, type DeployRecordCommit, type RecordRef } from './records.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { TaskRunner } from './execution/interfaces.js';

const encodeTaskObject = encodeBeast2For(TaskObjectType);
const typesEqual = equalFor(EastTypeType);

/**
 * What a deploy does with a record it cannot keep as it is.
 *
 * - `migrate` runs the migrations the workspace has not applied, and refuses a
 *   record no migration carries to the package's type.
 * - `fail` runs none: a record with migrations to apply is refused, for a
 *   workspace whose migrations go through their own change control.
 * - `reset` resets a record it cannot keep or migrate to the package's
 *   initial value, under a `$reset` commit, so the reset is in its history.
 */
export type SchemaPolicy = 'migrate' | 'fail' | 'reset';

/** What a deploy decided for one record. */
export type RecordPlan =
  /** Not in the workspace: minted from the package's initial value. */
  | { record: string; action: 'mint' }
  /** Kept as the workspace holds it. `deploy` when the package under it
   *  changed, which a `$deploy` commit records in its history. */
  | { record: string; action: 'keep'; deploy: boolean }
  /** Migrated by the steps the workspace has not applied, in order. */
  | { record: string; action: 'migrate'; steps: string[] }
  /** Reset to the package's initial value under the `reset` policy, and why
   *  it could not be kept or migrated. */
  | { record: string; action: 'reset'; reason: string }
  /** Not in the package: dropped, with its state and history. Only a deploy
   *  that allows it drops a record. */
  | { record: string; action: 'drop' }
  /** Refused, and why, with the fix: the deploy writes nothing. */
  | { record: string; action: 'refused'; reason: string };

/** A workspace's deployment, as a deploy over it finds it. */
export interface PriorDeployment {
  /** The deployed package's object hash. */
  packageHash: string;
  /** Record ref path -> the ref the workspace holds and the type the deployed
   *  package declares the record as. */
  records: Map<string, { ref: RecordRef; type: EastTypeValue }>;
}

/** What a deploy does to one record, and what it needs to do it. */
export interface RecordDeployment {
  /** What the deploy decided. */
  plan: RecordPlan;
  /** The record's ref path. */
  path: string;
  /** The hash of the package's initial value; absent for a record the
   *  package does not declare. */
  initial?: string;
  /** The ref the workspace holds; absent for a record it does not. */
  prior?: RecordRef;
  /** The package's migration chain, by name. */
  chain: string[];
  /** The steps to run, in order, for a record to migrate. */
  steps: Array<{ name: string; object: MigrationObject }>;
}

/**
 * The East type of the dataset leaf at a ref path, as a package's structure
 * declares it.
 *
 * @param structure - The package's data structure
 * @param refPath - The dataset's ref path, such as `records/orders`
 * @returns The leaf's type, or undefined when the path names no dataset
 */
export function recordLeafType(structure: Structure, refPath: string): EastTypeValue | undefined {
  let current: Structure = structure;
  for (const segment of refPath.split('/')) {
    if (current.type !== 'struct') return undefined;
    const next = current.value.get(segment);
    if (!next) return undefined;
    current = next;
  }
  return current.type === 'value' ? current.value.type : undefined;
}

/** A type as a refusal names it: its head, and its members by name. */
const describe = (type: EastTypeValue): string => printTypeValueSummary(type, 2, 8);

/** What changed between two types, one location per line; both types when
 *  the two differ where assignability cannot see, as a subtype does. */
function typeChange(held: EastTypeValue, declared: EastTypeValue): string {
  const diff = renderTypeDiff(diffTypeValues(held, declared));
  return diff !== '' ? diff : `from ${describe(held)} to ${describe(declared)}`;
}

/** A list of step names as a refusal says it. */
const named = (names: readonly string[]): string =>
  names.length === 0 ? 'none' : names.map((name) => `'${name}'`).join(', ');

/**
 * Decide what a deploy does to each record, before it writes anything.
 *
 * @remarks
 * For a record the package declares:
 * - the workspace does not hold it: `mint`;
 * - it has applied the whole chain and its type is the package's: `keep`;
 * - it has applied the whole chain and its type is not the package's: refused,
 *   the type changed with no migration;
 * - it has applied a proper prefix of the chain: `migrate`, by the rest. The
 *   state's type must be what the first remaining step takes, and each step
 *   must take what the one before leaves;
 * - it has applied anything else: refused, since an applied migration was
 *   renamed, reordered or removed, or the package is older than the workspace.
 *
 * Under `reset` a record the other rules refuse is reset instead, and under
 * `fail` one with steps to run is refused. A record the workspace holds and
 * the package does not declare is dropped only when the deploy allows it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param pkg - The package being deployed
 * @param packageHash - Its object hash
 * @param prior - The workspace's deployment, or null when it has none
 * @param policy - What to do with a record that cannot be kept as it is
 * @param allowDropRecords - Whether a record the package no longer declares
 *   may be dropped
 * @returns One deployment per record, the package's first
 */
export async function planRecordDeployments(
  storage: StorageBackend,
  repo: string,
  pkg: PackageObject,
  packageHash: string,
  prior: PriorDeployment | null,
  policy: SchemaPolicy,
  allowDropRecords: boolean,
): Promise<RecordDeployment[]> {
  const deployments: RecordDeployment[] = [];
  const declared = new Set<string>();
  for (const recordHash of pkg.records.values()) {
    const recordObject = decodeRecordObject(await storage.objects.read(repo, recordHash));
    const path = recordObject.path;
    declared.add(path);
    const initial = pkg.data.refs.get(path);
    const type = recordLeafType(pkg.data.structure, path);
    if (initial?.type !== 'value' || type === undefined) continue; // a record always has an initial value
    const chain = recordObject.migrations.map((step) => step.name);
    const deployment = { path, initial: initial.value.hash, chain, steps: [] };

    const held = prior?.records.get(path);
    if (held === undefined) {
      deployments.push({ ...deployment, plan: { record: path, action: 'mint' } });
      continue;
    }
    const fix = policy === 'reset' ? '' : ' Deploy with --schema=reset to reset it to the package\'s initial value.';
    const refuse = (reason: string): RecordDeployment => ({
      ...deployment,
      prior: held.ref,
      plan: policy === 'reset' ? { record: path, action: 'reset', reason } : { record: path, action: 'refused', reason: `${reason}${fix}` },
    });

    const applied = appliedMigrations(held.ref.versions);
    if (applied.length > chain.length || applied.some((name, i) => chain[i] !== name)) {
      deployments.push(refuse(
        `has had migrations ${named(applied)} applied, and the package declares ${named(chain)}: ` +
        `an applied migration was renamed, reordered or removed, or the package is older than the workspace.`,
      ));
      continue;
    }
    if (applied.length === chain.length) {
      deployments.push(typesEqual(held.type, type)
        ? { ...deployment, prior: held.ref, plan: { record: path, action: 'keep', deploy: prior!.packageHash !== packageHash } }
        : refuse(
          `changed type with no migration:\n${typeChange(held.type, type).replace(/^/gm, '    ')}\n` +
          `  Declare a migration ${chain.length === 0 ? 'for it' : `after '${chain[chain.length - 1]}'`} to carry its state.`,
        ));
      continue;
    }

    const steps: RecordDeployment['steps'] = [];
    for (const { name, migration } of recordObject.migrations.slice(applied.length)) {
      steps.push({ name, object: decodeMigrationObject(await storage.objects.read(repo, migration)) });
    }
    // The chain starts where the workspace is and ends where the package
    // declares the record, each step taking what the one before leaves. The
    // SDK checks the last two when it builds the package; the first is the
    // workspace's to meet.
    let at = held.type;
    let broken: string | undefined;
    for (const [i, step] of steps.entries()) {
      if (!typesEqual(at, step.object.from)) {
        broken = i === 0
          ? `holds its state as ${describe(at)}, and its next migration, '${step.name}', takes it as ${describe(step.object.from)}.`
          : `has a migration, '${step.name}', that takes it as ${describe(step.object.from)}, where '${steps[i - 1]!.name}' leaves it as ${describe(at)}.`;
        break;
      }
      at = step.object.to;
    }
    if (broken === undefined && !typesEqual(at, type)) {
      broken = `has a last migration, '${steps[steps.length - 1]!.name}', that leaves it as ${describe(at)}, and the package declares it as ${describe(type)}.`;
    }
    if (broken !== undefined) {
      deployments.push(refuse(broken));
    } else if (policy === 'fail') {
      deployments.push({
        ...deployment,
        prior: held.ref,
        plan: {
          record: path,
          action: 'refused',
          reason: `has migrations ${named(steps.map((step) => step.name))} to run, and this deploy runs none. ` +
            `Deploy with --schema=migrate to run them.`,
        },
      });
    } else {
      deployments.push({ ...deployment, prior: held.ref, steps, plan: { record: path, action: 'migrate', steps: steps.map((step) => step.name) } });
    }
  }

  for (const [path, held] of prior?.records ?? []) {
    if (declared.has(path)) continue;
    deployments.push({
      path,
      prior: held.ref,
      chain: [],
      steps: [],
      plan: allowDropRecords
        ? { record: path, action: 'drop' }
        : {
          record: path,
          action: 'refused',
          reason: 'is not declared by the package, so deploying drops its state and history. Deploy with --allow-drop-records to drop it.',
        },
    });
  }
  return deployments;
}

/** The output a migration step's task writes: the new state whole, or the
 *  output kind its program emits into. */
function stepOutput(step: MigrationObject): TaskOutputKind {
  if (step.form === 'value') return variant('value', null);
  switch (step.to.type) {
    case 'Dict': return variant('dict', { merge: none });
    case 'Array': return variant('array', null);
    case 'Set': return variant('set', null);
    default: throw new Error(`a ${step.form} migration writes a Dict, an Array or a Set, not ${describe(step.to)}`);
  }
}

/**
 * Run the migrations a deploy owes, before it writes anything.
 *
 * @remarks
 * Each step runs as a task over the record's state before it: a `value` step
 * as one unit, whose runner opens the state lazily, and a `rows` or `rekey`
 * step as a task split over the state into the output kind its program emits
 * into, so a record of any size migrates a piece at a time. The steps write
 * objects and no ref: a failure leaves the workspace as it was, and a deploy
 * run again is served the steps that finished from the execution cache. What
 * they write is named by nothing until the deploy commits, so the caller
 * holds the tasks lock across both.
 *
 * A record's indexes are built over its migrated state afterwards, as the
 * deploy builds every index it owes.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param deployments - What the deploy decided for each record
 * @param runner - Task runner for the steps
 * @returns Record ref path -> each step's name and the state it left, in order
 * @throws {Error} When a step is owed and no runner was given, or a step fails.
 */
export async function runRecordMigrations(
  storage: StorageBackend,
  repo: string,
  deployments: readonly RecordDeployment[],
  runner?: TaskRunner,
): Promise<Map<string, Array<{ name: string; state: string }>>> {
  const migrated = new Map<string, Array<{ name: string; state: string }>>();
  for (const deployment of deployments) {
    if (deployment.plan.action !== 'migrate') continue;
    if (runner === undefined) {
      throw new Error(
        `deploying record '${deployment.path}' must run migrations ${named(deployment.plan.steps)}, ` +
        `but this deploy was given no task runner.`,
      );
    }
    let state = (await readRecordState(storage, repo, deployment.prior!.hash)).primary;
    const states: Array<{ name: string; state: string }> = [];
    for (const { name, object } of deployment.steps) {
      const taskHash = await storage.objects.write(repo, encodeTaskObject({
        kind: TASK_OBJECT_KIND,
        body: variant('east', { program: object.form === 'value' ? object.bodyIr : object.programIr }),
        runner: object.runner,
        inputs: [{ path: [], partition: object.form === 'value' ? none : some({ by: [] }) }],
        output: { path: [], kind: stepOutput(object) },
        role: variant('data', null),
        environment: none,
      }));
      const result = await runner.execute(storage, taskHash, [state]);
      if (result.state !== 'success' || result.outputHash === undefined) {
        throw new Error(
          `migrating record '${deployment.path}' failed at '${name}': ` +
          `${result.error ?? (result.exitCode !== undefined ? `exit code ${result.exitCode}` : 'the step wrote no output')}`,
        );
      }
      state = result.outputHash;
      states.push({ name, state });
    }
    migrated.set(deployment.path, states);
  }
  return migrated;
}

/**
 * What a deploy commits to each record it keeps, once it has written the
 * package's refs.
 *
 * @param deployments - What the deploy decided for each record
 * @param migrated - The states {@link runRecordMigrations} left
 * @returns One commit per record the deploy mints, keeps, migrates or resets
 */
export function recordDeployCommits(
  deployments: readonly RecordDeployment[],
  migrated: ReadonlyMap<string, ReadonlyArray<{ name: string; state: string }>>,
): DeployRecordCommit[] {
  const commits: DeployRecordCommit[] = [];
  for (const { plan, path, initial, prior, chain } of deployments) {
    switch (plan.action) {
      case 'mint': commits.push({ kind: 'mint', path, state: initial!, applied: chain }); break;
      case 'keep': commits.push({ kind: 'keep', path, prior: prior!, deployed: plan.deploy }); break;
      case 'migrate': commits.push({ kind: 'migrate', path, prior: prior!, steps: migrated.get(path)!, applied: chain }); break;
      case 'reset': commits.push({ kind: 'reset', path, prior: prior!, state: initial!, applied: chain }); break;
      case 'drop': case 'refused': break;
    }
  }
  return commits;
}
