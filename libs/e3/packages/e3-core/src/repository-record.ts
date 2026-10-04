/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository record, and the store upgrades an e3 applies when it opens a
 * repository an older release wrote.
 *
 * The record — the release that last wrote the repository, and the upgrades it
 * has had — is kept through the ref store, and every step goes through the
 * storage backend, so every backend keeps the record and the same open applies
 * its steps: the ones every backend shares, here, and the backend's own
 * ({@link StorageBackend.upgrades}).
 */

import { E3_RELEASE, type RepositoryRecord } from '@elaraai/e3-types';
import { RepoLayoutError, RepositoryBusyError, RepositoryUpgradePendingError } from './errors.js';
import { withKeyedLock } from './keyed-mutex.js';
import { withRepositoryHeld } from './running-work.js';
import type { RepositoryUpgrade, StorageBackend } from './storage/interfaces.js';
import { dataflowEventsApart } from './upgrades/dataflow-events-apart.js';
import { dataflowForceTasks } from './upgrades/dataflow-force-tasks.js';
import { executionStopReasons } from './upgrades/execution-stop-reasons.js';
import { runningExecutionsIndexed } from './upgrades/running-executions-indexed.js';
import { taskRunsIndexed } from './upgrades/task-runs-indexed.js';

/**
 * The store upgrades every backend applies, in the order they apply: a change
 * to a record's East type, or to what every store keeps beside its records.
 *
 * @remarks
 * - `execution-stop-reasons`: a stopped execution's record says why it
 *   stopped ({@link executionStopReasons}).
 * - `dataflow-force-tasks`: a stored dataflow run forces none of its tasks,
 *   all of them, or the ones it names ({@link dataflowForceTasks}).
 * - `dataflow-events-apart`: a stored dataflow run's events are kept apart
 *   from its state ({@link dataflowEventsApart}).
 * - `running-executions-indexed`: every store indexes the executions
 *   recorded running ({@link runningExecutionsIndexed}).
 * - `task-runs-indexed`: every store indexes each task's runs
 *   ({@link taskRunsIndexed}).
 *
 * A release that changes a stored form appends its step, and never edits,
 * reorders or removes a step a release has shipped. A test registers a step of
 * its own here, and removes it after.
 *
 * @internal
 */
export const REPOSITORY_UPGRADES: RepositoryUpgrade[] = [
  executionStopReasons, dataflowForceTasks, dataflowEventsApart, runningExecutionsIndexed, taskRunsIndexed,
];

/** How long an open that owes upgrades waits for work running in the
 *  repository to finish, unless its caller says otherwise. */
const UPGRADE_WAIT_MS = 30_000;

/** How long a part of a step an open applies runs before the open records
 *  where it stopped: what a crash mid-step loses of its work at most. */
const UPGRADE_PART_MS = 10_000;

/** How {@link repositoryOpen} treats a repository that owes upgrades, and
 *  work running in it. */
export interface RepositoryOpenOptions {
  /**
   * Whether the open applies the upgrades the repository owes: true unless
   * set. `false` refuses at once, naming them, and applies nothing, which a
   * host passes that applies them in a job of its own — an open there, that
   * does — rather than in whichever request comes first, whose time limit a
   * step may outlast.
   */
  apply?: boolean;
  /**
   * How long, in milliseconds, an open that owes upgrades waits for work
   * running in the repository to finish before it refuses: 30 s unless set,
   * as a person running the CLI waits. `0` refuses at once, which a request
   * that must never be held for the wait passes — a server's gate.
   */
  waitMs?: number;
}

/**
 * A new repository's record: this release, and every upgrade the backend
 * creating it knows — its own and the shared ones — since a new repository is
 * in the forms they write.
 *
 * @param backendUpgrades - The creating backend's own upgrades
 *   ({@link StorageBackend.upgrades})
 * @returns The record a backend writes when it creates a repository
 */
export function newRepositoryRecord(backendUpgrades: readonly RepositoryUpgrade[]): RepositoryRecord {
  return {
    release: E3_RELEASE,
    upgrades: knownUpgrades(backendUpgrades).map((upgrade) => ({ name: upgrade.name, release: E3_RELEASE })),
  };
}

/**
 * Opens a repository: checks it is there, reads its record, refuses one this
 * e3 cannot read, and applies the store upgrades it has not had, in order,
 * before anything else reads it.
 *
 * @remarks
 * Every way into a repository opens it: the CLI, the API server at start (one
 * repository) or on each request (several), and any host that mounts the API's
 * routes. A repository that has had every step this e3 knows costs a read of
 * its record. One that has not is upgraded with the repository held still, and
 * its record is read again once it is held, so of two opens at once one applies
 * the steps and the other finds them applied. The backend's own steps apply
 * first, then the shared ones, and each is recorded, with this release, as soon
 * as it is applied, so a repository opened again after a crash between two
 * steps is given only the second. A step applies in parts of 10 s, and where
 * each stopped is recorded beside the record, so a step a crash cut short is
 * taken up where its last part stopped, by this open or another process.
 *
 * A repository that has had a step this e3 does not know was upgraded by a
 * newer e3, and is refused, naming the release that applied it. Releases that
 * change no stored form ship no step, so they open each other's repositories
 * either way.
 *
 * An open that owes steps waits for work running in the repository to finish
 * for as long as `options.waitMs` says, 30 s unless set, and then refuses. An
 * open that may not wait refuses at once, naming the steps owed and the work
 * that holds the repository, and applies nothing: that work is left running,
 * and stopping it is its own route's.
 *
 * An open that leaves the steps to a job (`options.apply: false`) refuses at
 * once, naming them, whether or not work runs in the repository: its host
 * applies them in a job of its own, by an open there that applies them, which
 * waits for running work as any open does.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - Whether to apply the upgrades a repository owes, and how
 *   long to wait for work running in it
 * @returns The record, once every step this e3 knows is applied
 * @throws {RepoNotFoundError} When there is no repository
 * @throws {RepoLayoutError} When the repository has no record this e3 reads,
 *   or has had an upgrade this e3 does not know
 * @throws {RepositoryUpgradePendingError} When the repository owes an upgrade
 *   and work running in it holds it past the wait, or the open leaves the
 *   upgrades it owes to a job
 */
export async function repositoryOpen(storage: StorageBackend, repo: string, options: RepositoryOpenOptions = {}): Promise<RepositoryRecord> {
  await storage.validateRepository(repo);
  const known = knownUpgrades(storage.upgrades);
  const record = await readRecord(storage, repo, known);
  if (owed(record, known).length === 0) return record;
  if (options.apply === false) {
    throw new RepositoryUpgradePendingError(repo, owed(record, known).map((upgrade) => upgrade.name), null, true);
  }
  return applyHeld(storage, repo, known, options.waitMs ?? UPGRADE_WAIT_MS, Infinity);
}

/** How {@link repositoryUpgradeStep} applies a part of the upgrades a
 *  repository owes. */
export interface RepositoryUpgradeStepOptions {
  /**
   * How long the part runs, in milliseconds, once it has done at least a unit
   * of a step's work: a whole number of zero or more. A host whose steps run
   * on compute with a time limit sets it under that limit, with room to record
   * where the part stopped.
   */
  budgetMs: number;
  /**
   * How long, in milliseconds, the part waits for work running in the
   * repository to finish before it refuses: 30 s unless set; `0` refuses at
   * once.
   */
  waitMs?: number;
}

/** What a part of the upgrades a repository owes leaves
 *  ({@link repositoryUpgradeStep}). */
export interface RepositoryUpgradeStepResult {
  /** The steps the repository still owes, in order: none once every step this
   *  e3 knows is applied */
  readonly owed: readonly string[];
}

/**
 * Applies a part of the upgrades a repository owes, bounded in time: what a
 * host's job runs in each of its invocations, where a step outlasts one, as
 * `repoGcStep` is for gc.
 *
 * @remarks
 * The part takes up the first step the repository owes where its last part
 * stopped, by this process or another (`RefStore.repositoryUpgradeRead`),
 * applies it until `options.budgetMs` has passed, and records where it
 * stopped; a step it finishes is recorded in the repository's record, and the
 * part goes on to the next while its time lasts. It runs with the repository
 * held still, as an open's steps do, waiting for work running in it for as
 * long as `options.waitMs` says.
 *
 * The job calls it until nothing is owed, and meanwhile an open that leaves the
 * steps to a job refuses (`repositoryOpen`'s `apply: false`), naming them. An
 * open that applies the steps takes them up as this does, so the job, or a
 * person running the CLI, finishes what either began.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - How long the part runs, and how long it waits for work
 *   running in the repository
 * @returns The steps the repository still owes
 * @throws {RangeError} When `options.budgetMs` is not a whole number of zero
 *   or more
 * @throws {RepoNotFoundError} When there is no repository
 * @throws {RepoLayoutError} When the repository has no record this e3 reads,
 *   or has had an upgrade this e3 does not know
 * @throws {RepositoryUpgradePendingError} When work running in the repository
 *   holds it past the wait
 */
export async function repositoryUpgradeStep(
  storage: StorageBackend,
  repo: string,
  options: RepositoryUpgradeStepOptions,
): Promise<RepositoryUpgradeStepResult> {
  if (!Number.isSafeInteger(options.budgetMs) || options.budgetMs < 0) {
    throw new RangeError(`a part's budgetMs is a whole number of zero or more, not ${options.budgetMs}`);
  }
  await storage.validateRepository(repo);
  const known = knownUpgrades(storage.upgrades);
  const record = await readRecord(storage, repo, known);
  if (owed(record, known).length === 0) return { owed: [] };
  const after = await applyHeld(storage, repo, known, options.waitMs ?? UPGRADE_WAIT_MS, Date.now() + options.budgetMs);
  return { owed: owed(after, known).map((upgrade) => upgrade.name) };
}

/**
 * Applies the steps a repository owes with it held still, in parts, until none
 * is owed or the clock passes `until`, recording where each part stopped.
 *
 * @remarks
 * One open in this process applies the steps, and the others wait for it and
 * find them applied. A part runs until 10 s have passed or `until` does,
 * whichever is first.
 *
 * @returns The record as the parts left it
 * @throws {RepositoryUpgradePendingError} When work running in the repository
 *   holds it past the wait
 */
async function applyHeld(
  storage: StorageBackend,
  repo: string,
  known: readonly RepositoryUpgrade[],
  waitMs: number,
  until: number,
): Promise<RepositoryRecord> {
  return withKeyedLock(`repository-open\u0000${repo}`, async () => {
    const before = await readRecord(storage, repo, known);
    if (owed(before, known).length === 0) return before;
    const hold = { doing: `upgrading the repository ${repo}`, ...(waitMs > 0 && { wait: waitMs }) };
    try {
      return await withRepositoryHeld(storage, repo, hold, async () => {
        let current = await readRecord(storage, repo, known);
        for (const upgrade of owed(current, known)) {
          let at = await takenUpAt(storage, repo, upgrade);
          for (;;) {
            at = await upgrade.apply(storage, repo, at, Math.min(until, Date.now() + UPGRADE_PART_MS));
            if (at === null) break;
            await storage.refs.repositoryUpgradeWrite(repo, { step: upgrade.name, release: E3_RELEASE, cursor: at });
            if (Date.now() >= until) return current;
          }
          current = { release: E3_RELEASE, upgrades: [...current.upgrades, { name: upgrade.name, release: E3_RELEASE }] };
          await storage.refs.repositoryWrite(repo, current);
          await storage.refs.repositoryUpgradeWrite(repo, null);
          if (Date.now() >= until) return current;
        }
        return current;
      });
    } catch (err) {
      if (err instanceof RepositoryBusyError) {
        throw new RepositoryUpgradePendingError(repo, owed(before, known).map((upgrade) => upgrade.name), err.workspace);
      }
      throw err;
    }
  });
}

/**
 * Where an owed step is taken up: where its last part stopped, when the step
 * under way is this one, or `null` to start it. A record of another step —
 * one recorded done before its progress was cleared — is passed over.
 */
async function takenUpAt(storage: StorageBackend, repo: string, upgrade: RepositoryUpgrade): Promise<string | null> {
  const progress = await storage.refs.repositoryUpgradeRead(repo);
  return progress !== null && progress.step === upgrade.name ? progress.cursor : null;
}

/**
 * Every upgrade a backend applies, in order: its own, then the shared ones.
 *
 * @throws {Error} When two steps share a name, which the record could not tell
 *   apart
 */
function knownUpgrades(backendUpgrades: readonly RepositoryUpgrade[]): RepositoryUpgrade[] {
  const all = [...backendUpgrades, ...REPOSITORY_UPGRADES];
  const names = new Set<string>();
  for (const { name } of all) {
    if (names.has(name)) throw new Error(`two repository upgrades are named ${JSON.stringify(name)}`);
    names.add(name);
  }
  return all;
}

/** The repository's record, or its refusal when this e3 cannot read the
 *  repository. */
async function readRecord(storage: StorageBackend, repo: string, known: readonly RepositoryUpgrade[]): Promise<RepositoryRecord> {
  const record = await storage.refs.repositoryRead(repo);
  if (record === null) throw new RepoLayoutError(repo, null);
  const names = new Set(known.map((upgrade) => upgrade.name));
  const unknown = record.upgrades.find((upgrade) => !names.has(upgrade.name));
  if (unknown !== undefined) throw new RepoLayoutError(repo, unknown);
  return record;
}

/** The steps this e3 knows that the repository has not had, in order. */
function owed(record: RepositoryRecord, known: readonly RepositoryUpgrade[]): RepositoryUpgrade[] {
  const had = new Set(record.upgrades.map((upgrade) => upgrade.name));
  return known.filter((upgrade) => !had.has(upgrade.name));
}
