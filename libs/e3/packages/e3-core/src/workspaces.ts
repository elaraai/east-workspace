/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Workspace operations for e3 repositories.
 *
 * Workspaces are mutable working copies of packages. They allow:
 * - Deploying a package to create a working environment
 * - Modifying data (inputs/outputs)
 * - Exporting changes back to a new package version
 *
 * A workspace's record is a `WorkspaceRecordType`: `none` from its creation
 * until a package is deployed, then its state. No record means the workspace
 * does not exist. A local repository keeps it at `workspaces/<name>.beast2`,
 * and its dataset refs at `workspaces/<ws>/data/<path>.beast2`.
 *
 * A deploy's `file` sources are read on the machine that has them
 * (`workspace-files.ts`). An export writes its zip to a stream here, as every
 * backend does; one to a file on this machine, or to a Node stream, is the
 * root entry's.
 */

import { decodeBeast2For, encodeBeast2For, variant, none, some, StringType, type EastTypeValue } from '@elaraai/east';
import {
  E3_RELEASE, ExecutionStatusType, PackageObjectType, WorkspaceRecordType, decodePackageObject, decodeRecordObject, isCollectionRoot,
} from '@elaraai/e3-types';
import type {
  DatasetRef, DeployProgress, IntakeFile, IntakeStep, LockStatus, PackageObject, RecordDeployState, RecordDeployStep, RecordIndexPlan,
  RecordObject, RecordPlan, SchemaPolicy, WorkspaceState, TreePath,
} from '@elaraai/e3-types';
import type { DatasetAdoptProgress, DatasetTaken, ObjectAdoptResult } from './dataset-adopt.js';
import { eachAtMost } from './concurrency.js';
import { ZIP_RELEASE_ENTRY, addPackageObjects, packageResolve, packageRead, writePackageZip } from './packages.js';
import { zipSinkOf } from './zip.js';
import type { PackageZipCheckpoint } from './transfer/types.js';
import { writeRefsFromPackage, refPathToKeypath } from './dataset-refs.js';
import { workspaceSetDatasetByHash } from './trees.js';
import {
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceExistsError,
  WorkspaceLockError,
  RecordDeployRefusedError,
  checkName,
  lockStateToHolderInfo,
} from './errors.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';
import type { TaskRunner } from './execution/interfaces.js';
import { buildDeployIndexes, commitDeployIndexes, commitDeployRecords, recordLeafType } from './records.js';
import { planRecordDeployments, recordDeployCommits, runRecordMigrations, type PriorDeployment } from './record-deploy.js';
import { withRunningWork } from './running-work.js';

/**
 * List workspace names.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @returns Array of workspace names
 */
export async function workspaceList(storage: StorageBackend, repo: string): Promise<string[]> {
  return storage.refs.workspaceList(repo);
}

/**
 * Write a deployed workspace's state via storage backend.
 */
async function writeState(storage: StorageBackend, repo: string, name: string, state: WorkspaceState): Promise<void> {
  await storage.refs.workspaceWrite(repo, name, encodeBeast2For(WorkspaceRecordType)(some(state)));
}

/**
 * Read workspace state.
 * Returns { exists: false } if workspace doesn't exist.
 * Returns { exists: true, deployed: false } if workspace exists but not deployed.
 * Returns { exists: true, deployed: true, state } if workspace is deployed.
 */
async function readState(
  storage: StorageBackend,
  repo: string,
  name: string
): Promise<
  | { exists: false }
  | { exists: true; deployed: false }
  | { exists: true; deployed: true; state: WorkspaceState }
> {
  const data = await storage.refs.workspaceRead(repo, name);

  if (data === null) {
    return { exists: false };
  }

  const record = decodeBeast2For(WorkspaceRecordType)(data);
  if (record.type === 'none') {
    return { exists: true, deployed: false };
  }
  return { exists: true, deployed: true, state: record.value };
}

/**
 * Read workspace state, throwing if workspace doesn't exist or is not deployed.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but has no package deployed
 * @internal
 */
export async function readStateOrThrow(storage: StorageBackend, repo: string, name: string): Promise<WorkspaceState> {
  const result = await readState(storage, repo, name);
  if (!result.exists) {
    throw new WorkspaceNotFoundError(name);
  }
  if (!result.deployed) {
    throw new WorkspaceNotDeployedError(name);
  }
  return result.state;
}


/**
 * Create an empty workspace.
 *
 * Creates an undeployed workspace: its record is `none`.
 * Use workspaceDeploy to deploy a package.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @throws {WorkspaceExistsError} If workspace already exists
 */
export async function workspaceCreate(
  storage: StorageBackend,
  repo: string,
  name: string
): Promise<void> {
  // Check if workspace already exists
  const existing = await storage.refs.workspaceRead(repo, name);
  if (existing !== null) {
    throw new WorkspaceExistsError(name);
  }

  await storage.refs.workspaceWrite(repo, name, encodeBeast2For(WorkspaceRecordType)(none));
}

/**
 * Options for workspace removal.
 */
export interface WorkspaceRemoveOptions {
  /**
   * External workspace lock to use. If provided, the caller is responsible
   * for releasing the lock after the operation. If not provided, workspaceRemove
   * will acquire and release a lock internally.
   */
  lock?: LockHandle;
}

/**
 * Remove a workspace.
 *
 * Objects remain until repoGc is run.
 *
 * Acquires a workspace lock to prevent removing a workspace while a dataflow
 * is running. Throws WorkspaceLockError if the workspace is currently locked.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param options - Optional settings including external lock
 * @throws {InvalidNameError} If `name` is no workspace's name, before the lock
 *   is taken
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceLockError} If workspace is locked by another process
 */
export async function workspaceRemove(
  storage: StorageBackend,
  repo: string,
  name: string,
  options: WorkspaceRemoveOptions = {}
): Promise<void> {
  // The name is checked as a workspace's before the lock is taken: a lock's
  // name may hold the `#` and `~` no workspace's may, so the lock store would
  // refuse a malformed one, if at all, as a lock's, and `main#dataflow` would
  // take the lock a run of main's dataflow holds.
  checkName('workspace', name);

  // Acquire lock if not provided externally
  const externalLock = options.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('removal', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? lockStateToHolderInfo(state) : undefined);
    }
  }
  try {
    // Check if workspace exists
    const existing = await storage.refs.workspaceRead(repo, name);
    if (existing === null) {
      throw new WorkspaceNotFoundError(name);
    }

    // Remove all dataset refs for this workspace
    await storage.datasets.removeAll(repo, name);

    await storage.refs.workspaceRemove(repo, name);
  } finally {
    // Only release the lock if we acquired it internally
    if (!externalLock) {
      await lock.release();
    }
  }
}

/**
 * Get the full state for a workspace.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @returns Workspace state, or null if workspace doesn't exist or is not deployed
 */
export async function workspaceGetState(
  storage: StorageBackend,
  repo: string,
  name: string
): Promise<WorkspaceState | null> {
  const result = await readState(storage, repo, name);
  if (!result.exists || !result.deployed) {
    return null;
  }
  return result.state;
}

/**
 * Get the deployed package for a workspace.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @returns Package name, version, and hash
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but has no package deployed
 */
export async function workspaceGetPackage(
  storage: StorageBackend,
  repo: string,
  name: string
): Promise<{ name: string; version: string; hash: string }> {
  const state = await readStateOrThrow(storage, repo, name);
  return {
    name: state.packageName,
    version: state.packageVersion,
    hash: state.packageHash,
  };
}

/**
 * What holds a workspace exclusively, and how far that operation says it has
 * got.
 *
 * @remarks
 * A workspace deployed for the first time is not deployed until its deploy
 * ends, so it has no status to read meanwhile; its lock says a deploy holds it,
 * and how far the deploy has got with its file sources and its records.
 *
 * The name is a workspace's, checked as one before the lock store is asked: a
 * lock's resource may hold `#` and `~`, which join the parts of lock names, so
 * `main#dataflow` — the lock a run of main's dataflow holds — would otherwise
 * be read as the lock of a workspace that cannot exist.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @returns The lock's state and what its holder last reported, or null when
 *   nothing holds the workspace exclusively
 * @throws {InvalidNameError} When the name is no workspace's: it holds `#` or
 *   `~`, or a character a file name cannot hold
 */
export async function workspaceLockStatus(
  storage: StorageBackend,
  repo: string,
  name: string,
): Promise<LockStatus | null> {
  checkName('workspace', name);
  const state = await storage.locks.getState(repo, name);
  if (state === null) return null;
  const progress = await storage.locks.getProgress(repo, name);
  return { state, progress: progress === null ? none : some(progress) };
}

/**
 * How far a deploy has got with one of its `file` sources.
 */
export interface DeploySourceProgress {
  /** The input's path in the workspace, as `inputs/<name>`. */
  readonly path: string;
  /** The delivery's file. */
  readonly file: string;
  /** `hash` while the file is read for its SHA-256, which says whether the
   *  store already knows it; `take-in` while intake units take it in; `done`
   *  once it is in. */
  readonly phase: 'hash' | 'take-in' | 'done';
  /** Bytes of the file the phase has covered: read for its hash, or covered by
   *  the pieces taken in; the file's size once `done`. */
  readonly bytes: number;
  /** The file's size. */
  readonly total: number;
  /** In `take-in`: the delivery's pieces, and how many have been taken in. */
  readonly pieces?: { readonly done: number; readonly total: number };
  /** Once `done`: how the file was taken in. */
  readonly taken?: DatasetTaken;
  /** Once `done`, when `taken`: the runners that took it in. */
  readonly runners?: readonly string[];
  /** Once `done`: why a runner fell back to another, when one did. */
  readonly fallback?: string;
  /** Every `file` source the deploy takes in: how many, and their bytes
   *  together. */
  readonly sources: { readonly count: number; readonly bytes: number };
}

/**
 * Options for workspace deployment.
 */
export interface WorkspaceDeployOptions {
  /**
   * What the deploy does with a record it cannot keep as it is: run the
   * migrations the workspace has not applied (`migrate`), refuse to run any
   * (`fail`), or reset it to the package's initial value (`reset`).
   *
   * @defaultValue 'migrate'
   */
  schema?: SchemaPolicy;
  /**
   * Whether a record the package no longer declares may be dropped, with its
   * state and history. Without it the deploy is refused.
   *
   * @defaultValue false
   */
  allowDropRecords?: boolean;
  /**
   * Say what the deploy would do, through {@link onRecordPlan} and
   * {@link onRecordIndex}, and write nothing. A plan with refusals reports
   * them rather than throwing.
   *
   * @defaultValue false
   */
  plan?: boolean;
  /**
   * Called once per record the deploy touches, with what it decided: `mint`,
   * `keep`, `migrate`, `reset`, `drop` or `refused`.
   *
   * @remarks
   * Called before the deploy writes anything, and before it refuses: a
   * migration over a large record is the part of a deploy that takes minutes,
   * and a refusal is the part an operator acts on.
   */
  onRecordPlan?: (plan: RecordPlan) => void;
  /**
   * Called once per declared or dropped index of every record the deploy
   * touches, with what the deploy decided: `build`, `drop` or `keep`.
   *
   * @remarks
   * An index is derived, so a deploy reconciles it without asking — but which
   * indexes it is about to build is the one thing an operator wants to know
   * before a deploy over a large record takes minutes.
   */
  onRecordIndex?: (plan: RecordIndexPlan) => void;
  /**
   * External workspace lock to use. If provided, the caller is responsible
   * for releasing the lock after the operation. If not provided, workspaceDeploy
   * will acquire and release a lock internally.
   */
  lock?: LockHandle;
  /**
   * Whether this deploy reads the package's `file` sources and adopts them.
   *
   * @remarks
   * A `file` source names a path on the machine that EXPORTS the package. A
   * local deploy runs on that machine, so by default each delivery is opened,
   * its header checked against the declared type, and the file adopted by hash.
   *
   * A server deploying on behalf of a client must pass `false`. The path is the
   * client's, and a server that opened it would adopt whatever server-readable
   * file of the declared type sits there — another repository's object under
   * the same repositories directory, given its hash. With `false` no path is
   * opened: every `file` source is left unassigned with a warning through
   * {@link WorkspaceDeployOptions.sourceWarning}, and the client completes it
   * over the dataset transfer protocol, whose commit runs the same validation.
   *
   * @defaultValue true
   */
  resolveFileSources?: boolean;
  /**
   * Task runner for the migrations and index builds a deploy owes, and the
   * intake units that take its collection file sources in.
   *
   * @remarks
   * A record that declares an index needs that index built before anything can
   * read through it, and an index is built by running its program on the
   * runner its author chose. Deploy is where that debt falls due: a record
   * minted here has no index yet, and a record whose declaration changed has
   * one built under the wrong declaration. A migration runs on its author's
   * runner too. A collection delivery is taken in by intake units, in pieces,
   * on the runner.
   *
   * Omit it only where no package can declare an index, a migration or a
   * collection file source: a deploy that owes any of them without a runner is
   * refused before it writes anything.
   */
  runner?: TaskRunner;
  /**
   * The sink for warnings about `file` sources this deploy leaves unassigned.
   *
   * @remarks
   * With `resolveFileSources: false` it receives one warning per `file`
   * source. When sources are resolved it also turns an unreadable delivery into
   * a warning and an unassigned input; without a sink that delivery fails the
   * deploy, which is what a developer deploying locally wants. It never makes
   * this process read a path, and a type MISMATCH always fails, sink or not —
   * that is a broken package, not a missing file.
   */
  sourceWarning?: (message: string) => void;
  /**
   * How many `file` sources the deploy takes in at once.
   *
   * @remarks
   * Each delivery is hashed and taken in on its own, so a deploy of many takes
   * them in side by side, their pieces sharing the runner's room. A local
   * deploy takes as many as its budget has cores.
   *
   * @defaultValue 1
   */
  sourceConcurrency?: number;
  /**
   * Called as the deploy takes in each `file` source: as its file is hashed
   * and read, and once it is in.
   */
  onSourceProgress?: (progress: DeploySourceProgress) => void;
  /**
   * Called with how far the deploy has got — each file source's step and each
   * record's — as it reports it through its lock for a watcher to read: a
   * deploy job's status carries it for the client polling the job.
   *
   * @remarks
   * Called as the deploy starts, as each file source is in and each record's
   * step moves, and in between at most every half second. A call is awaited
   * before the next is made, and none is made once the deploy has returned; a
   * call that fails is dropped.
   */
  onDeployProgress?: (progress: DeployProgress) => void | Promise<void>;
}

/**
 * The files a deploy's `file` sources name, as the machine the deploy runs on
 * reads them: a delivery's header checked against its declared type, its size,
 * and its adoption.
 *
 * @internal
 */
export interface DeployFiles {
  /**
   * Reads a delivery's header and checks it holds the declared type.
   *
   * @param file - The delivery's path
   * @param subject - The input, as a refusal names it
   * @param type - The type the input declares
   * @returns `null` when the file reads as the declared type; otherwise why it
   *   does not read, which the deploy reports as a missing delivery
   * @throws The type mismatch, when the file holds another type: a broken
   *   package, which fails the deploy whatever its warning sink.
   */
  check(file: string, subject: string, type: EastTypeValue): { readonly err: unknown } | null;
  /**
   * The delivery's size in bytes.
   *
   * @param file - The delivery's path
   */
  size(file: string): Promise<number>;
  /**
   * Adopts the delivery into the object store, as the root entry's
   * `objectAdoptFile` does.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param file - The delivery's path
   * @param options - The type it declares, the runner that takes a collection
   *   in, the signal that stops it, and a listener for how far it has got
   */
  adopt(
    storage: StorageBackend,
    repo: string,
    file: string,
    options: {
      declared: { subject: string; type: EastTypeValue };
      runner: TaskRunner | undefined;
      signal: AbortSignal;
      onProgress: (progress: DatasetAdoptProgress) => void;
    },
  ): Promise<ObjectAdoptResult>;
}

/** Why a deploy that reads no files leaves a `file` source: it names a file on
 *  a machine this e3 does not read. */
function readsNoFiles(subject: string, file: string): Error {
  return new Error(`${subject} is the file ${file}, and this e3 reads no files: deploy the package where the file lies, ` +
    'or complete the input over the dataset transfer protocol (resolveFileSources: false)');
}

/** The files of a deploy that reads none: each `file` source is one that does
 *  not read. */
const NO_FILES: DeployFiles = {
  check: (file, subject) => ({ err: readsNoFiles(subject, file) }),
  size: (file) => Promise.reject(readsNoFiles('a file source', file)),
  adopt: (_storage, _repo, file, { declared }) => Promise.reject(readsNoFiles(declared.subject, file)),
};

/**
 * Deploy a package to a workspace.
 *
 * Creates the workspace if it doesn't exist. Writes state file atomically
 * containing deployment info. Initializes per-dataset ref files from the
 * package's data/ directory.
 *
 * Acquires a workspace lock to prevent conflicts with running dataflows
 * or concurrent deploys. Throws WorkspaceLockError if the workspace is
 * currently locked by another process.
 *
 * A package's `file` source names a file on the machine that exported it,
 * which the root entry's `workspaceDeploy` reads. This entry reads no files:
 * each `file` source is one whose delivery does not read, which
 * {@link WorkspaceDeployOptions.sourceWarning} hears and the deploy leaves
 * unassigned, or which fails the deploy without a sink.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param pkgName - Package name
 * @param pkgVersion - Package version
 * @param options - Optional settings including external lock
 * @throws {InvalidNameError} If `name` is no workspace's name, before the lock
 *   is taken
 * @throws {WorkspaceLockError} If workspace is locked by another process
 * @throws {RecordDeployRefusedError} When a record cannot be carried into the
 *   package: it changed type with no migration, its applied migrations are not
 *   the package's, the policy runs none, or the package drops it
 * @throws {Error} When a garbage collection is running in the repository, the
 *   workspace's deployment does not read, or a migration or an index build
 *   fails
 */
export async function workspaceDeploy(
  storage: StorageBackend,
  repo: string,
  name: string,
  pkgName: string,
  pkgVersion: string,
  options: WorkspaceDeployOptions = {}
): Promise<void> {
  return workspaceDeployWith(storage, repo, name, pkgName, pkgVersion, options, NO_FILES);
}

/**
 * Deploy a package to a workspace, as {@link workspaceDeploy} does, reading
 * its `file` sources through `files`: what the root entry's `workspaceDeploy`
 * deploys through.
 *
 * @param files - How the files a `file` source names are read
 * @internal
 */
export async function workspaceDeployWith(
  storage: StorageBackend,
  repo: string,
  name: string,
  pkgName: string,
  pkgVersion: string,
  options: WorkspaceDeployOptions,
  files: DeployFiles,
): Promise<void> {
  // The name is checked as a workspace's before the lock is taken: a lock's
  // name may hold the `#` and `~` no workspace's may, so the lock store would
  // refuse a malformed one, if at all, as a lock's.
  checkName('workspace', name);

  // Acquire lock if not provided externally
  const externalLock = options.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('deployment', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? lockStateToHolderInfo(state) : undefined);
    }
  }
  try {
    // Resolve package hash and read package object
    const packageHash = await packageResolve(storage, repo, pkgName, pkgVersion);
    const pkg = await packageRead(storage, repo, pkgName, pkgVersion);

    // Decide what happens to each record BEFORE any destructive write, so a
    // refused redeploy leaves the workspace fully intact rather than
    // half-wiped with a torn state/data-dir mismatch.
    const prior = await readPriorDeployment(storage, repo, name);
    const deployments = await planRecordDeployments(
      storage, repo, pkg, packageHash, prior, options.schema ?? 'migrate', options.allowDropRecords ?? false,
    );
    for (const deployment of deployments) options.onRecordPlan?.(deployment.plan);
    const refusals = deployments.flatMap(({ plan }) =>
      plan.action.type === 'refused' ? [{ record: plan.record, reason: plan.action.value.reason }] : []);
    if (refusals.length > 0 && options.plan !== true) throw new RecordDeployRefusedError(refusals);

    // The state each record holds once the refs are written, which its
    // indexes are built over: the package's initial value for a record minted
    // or reset, the workspace's for one kept, and its last step's for one
    // migrated. A plan migrates nothing, and plans a migrated record's
    // indexes over the initial value, which names no index, as the migrated
    // state will not.
    const deploymentAt = new Map(deployments.map((deployment) => [deployment.path, deployment]));
    const stateOf = (migrated: ReadonlyMap<string, ReadonlyArray<{ state: string }>>) => (path: string): string | undefined => {
      const deployment = deploymentAt.get(path);
      if (deployment === undefined) return undefined;
      switch (deployment.plan.action.type) {
        case 'keep': return deployment.prior!.hash;
        case 'migrate': return migrated.get(path)?.at(-1)?.state ?? deployment.initial;
        case 'mint': case 'reset': return deployment.initial;
        default: return undefined;
      }
    };
    if (options.plan === true) {
      await buildDeployIndexes(storage, repo, pkg, stateOf(new Map()), undefined, options.onRecordIndex, true);
      return;
    }

    // A path-initialised input whose delivery is missing or has drifted
    // follows the same rule as a record: every file source is validated here,
    // before the wipe.
    const sourceFiles = validateDatasetSources(
      pkg, options.sourceWarning, options.resolveFileSources ?? true, files,
    );
    if (options.runner === undefined) {
      for (const [refPath, { declared }] of sourceFiles) {
        if (isCollectionRoot(declared.type)) {
          throw new Error(`input '${refPath.split('/').pop() ?? refPath}': a collection delivery is taken in by intake units, and the deploy was given no runner to run them`);
        }
      }
    }

    // The tasks lock is held from the first object this deploy writes — an
    // adopted delivery's segments, an index build's output — to the last ref
    // that names one, since until then nothing roots them against a sweep.
    const deployLock = lock;
    await withRunningWork(storage, repo, async () => {
      // Adopt every validated delivery into the object store, still before
      // the wipe. Objects are repo-wide and content-addressed, so this is safe
      // and idempotent whatever follows (an object no ref names is gc's to
      // collect), and it moves every step that can fail for an I/O reason —
      // the hash, a cross-device copy, ENOSPC, a delivery replaced since it
      // was validated — ahead of the first destructive write. Only the ref
      // writes come after.
      // They are taken in `sourceConcurrency` at a time. The first failure
      // stops the rest: none not yet started starts, and those in flight are
      // aborted — each waiting piece withdrawn, each running one stopped — so
      // a refusal is reported without waiting on the other files' intakes.
      const deliveries = [...sourceFiles];
      const stop = new AbortController();
      const hashes: string[] = new Array(deliveries.length);
      const sizes = await Promise.all(deliveries.map(([, { file }]) => files.size(file)));
      const sources = { count: deliveries.length, bytes: sizes.reduce((sum, size) => sum + size, 0) };
      // How far the deploy has got goes through its lock to whoever watches
      // the workspace, and to the caller.
      const reports = deployReports(async (progress) => {
        await Promise.all([deployLock.report(variant('deployment', progress)), options.onDeployProgress?.(progress)]);
      }, {
        package: { name: pkgName, version: pkgVersion },
        files: deliveries.map(([refPath], i) => ({ path: refPath, total: sizes[i]! })),
        records: deployments.map(({ plan, indexes }) => ({ plan, indexes })),
      });
      try {
        await eachAtMost(deliveries.map((_, i) => i), Math.max(1, options.sourceConcurrency ?? 1), async (i) => {
          const [refPath, { file, declared }] = deliveries[i]!;
          const hear = (progress: DeploySourceProgress): void => {
            options.onSourceProgress?.(progress);
            reports.file(progress);
          };
          const { hash, size, taken, runners, fallback } = await files.adopt(storage, repo, file, {
            declared,
            runner: options.runner,
            signal: stop.signal,
            onProgress: (progress) => hear({ path: refPath, file, sources, ...progress }),
          }).catch((err: unknown) => {
            stop.abort();
            throw err;
          });
          hashes[i] = hash;
          hear({
            path: refPath, file, sources, phase: 'done', bytes: size, total: size, taken,
            ...(runners !== undefined && { runners }), ...(fallback !== undefined && { fallback }),
          });
        });
        const adoptedSources = new Map(deliveries.map(([refPath], i) => [refPath, hashes[i]!]));

        // A migration and an index build both run user East, so they are the
        // steps likeliest to fail, and both run before the wipe below: a deploy
        // that fails leaves the workspace as it was. What they write is named
        // by nothing until the commits after the new refs. A record migrated
        // here has no index, and one minted here none either, so their indexes
        // are built over the state the record will hold, as a changed
        // declaration's are.
        const migrated = await runRecordMigrations(storage, repo, deployments, options.runner, (path, step) =>
          reports.record(path, variant('migrating', { name: step.name, step: BigInt(step.step), steps: BigInt(step.steps) })));
        const indexBuilds = await buildDeployIndexes(
          storage, repo, pkg, stateOf(migrated), options.runner, options.onRecordIndex, false, (path, build) =>
            reports.record(path, variant('indexing', { index: build.index, build: BigInt(build.build), builds: BigInt(build.builds) })),
        );
        reports.recordsDone();

        // Remove any existing dataset refs
        await storage.datasets.removeAll(repo, name);

        // Initialize per-dataset ref files from the package
        await writeRefsFromPackage(storage, repo, name, pkg.data.structure, pkg.data.refs);

        // Commit what was decided for each record: a minted one's `$init`, a
        // kept one's history with a `$deploy` commit when the package changed,
        // a migrated one's `$migrate` commit per step, a reset one's `$reset`.
        // A record is never unassigned, never silently reset, and its history
        // says what each deploy did to it.
        await commitDeployRecords(storage, repo, name, recordDeployCommits(deployments, migrated));
        await commitDeployIndexes(storage, repo, name, indexBuilds);

        await writeState(storage, repo, name, {
          packageName: pkgName,
          packageVersion: pkgVersion,
          packageHash,
          deployedAt: new Date(),
          currentRunId: none,
        });

        // Point each path-initialised input at the value adopted above — a ref
        // write per input. The self entry in the version vector names the
        // value's hash, which is what makes change detection exact for the
        // input's consumers.
        //
        // The file IS the value, so a new delivery under the same path is a new
        // hash: its consumers re-run, and a task that splits its work over it
        // keeps the pieces that did not move.
        for (const [refPath, hash] of adoptedSources) {
          await workspaceSetDatasetByHash(
            storage, repo, name, treePathOfRefPath(refPath), hash,
            new Map([[refPathToKeypath(refPath), hash]]),
          );
        }
      } finally {
        // Nothing is reported once the deploy has returned: a job's status is
        // its own from then on.
        await reports.settle();
      }
    });
  } finally {
    // Only release the lock if we acquired it internally
    if (!externalLock) {
      await lock.release();
    }
  }
}

/** `inputs/table` back to the tree path the dataset APIs take. */
function treePathOfRefPath(refPath: string): TreePath {
  return refPath.split('/').map(segment => variant('field', segment));
}

/** How often, at most, a deploy reports how far it has got, between the
 *  reports a file's end or a record's next step makes. */
const REPORT_MS = 500;

/**
 * Reports how far a deploy has got, for another process to read while it
 * runs: through the lock it holds, for a TUI watching the workspace, and to
 * its caller, for a deploy job's status.
 *
 * @remarks
 * Every file source and every record starts `waiting`. A record's step moves
 * as its migrations and index builds start, and a record whose work is over is
 * `done`. A report goes as the deploy starts, as each file is in and each
 * record's step moves, and in between at most every {@link REPORT_MS}. They go
 * one at a time, the latest replacing any not yet sent, so a slow store never
 * queues them. A report only shows the deploy, so one that fails is dropped
 * and the deploy carries on; once settled, nothing more is reported.
 *
 * @param report - Where each report goes
 * @param start - The package, each file source with its size, and each record
 *   with what the deploy decided for it and the indexes it declares
 * @returns What hears each file's progress and each record's step, marks the
 *   records done, and waits for the report in flight, and any held back, to
 *   land
 */
function deployReports(
  report: (progress: DeployProgress) => Promise<void>,
  start: {
    package: DeployProgress['package'];
    files: ReadonlyArray<{ path: string; total: number }>;
    records: ReadonlyArray<{ plan: RecordPlan; indexes: string[] }>;
  },
): {
  file(progress: DeploySourceProgress): void;
  record(path: string, step: RecordDeployStep): void;
  recordsDone(): void;
  settle(): Promise<void>;
} {
  const startedAt = new Date();
  const files = new Map<string, IntakeFile>(start.files.map(({ path, total }) =>
    [path, { path, step: variant('waiting', null), bytes: 0n, total: BigInt(total) }]));
  const records = new Map<string, RecordDeployState>(start.records.map(({ plan, indexes }) =>
    [plan.record, { plan, indexes, step: variant('waiting', null) }]));
  let active: string | null = null;
  let reportedAt = 0;
  let sending: Promise<void> | null = null;
  let heldBack = false;
  let settled = false;

  const send = (): void => {
    if (settled) return;
    if (sending !== null) {
      heldBack = true;
      return;
    }
    reportedAt = Date.now();
    sending = report({ package: start.package, startedAt, files: [...files.values()], records: [...records.values()] })
      .catch(() => {})
      .then(() => {
        sending = null;
        if (heldBack) {
          heldBack = false;
          send();
        }
      });
  };
  const moveTo = (path: string, step: RecordDeployStep): void => {
    const record = records.get(path);
    if (record !== undefined) records.set(path, { ...record, step });
  };

  send();
  return {
    file(progress) {
      const step: IntakeStep = progress.phase === 'hash' ? variant('hashing', null)
        : progress.phase === 'take-in' ? variant('taking_in', { pieces: BigInt(progress.pieces?.total ?? 0), done: BigInt(progress.pieces?.done ?? 0) })
        : progress.taken === 'known' ? variant('done', variant('known', null))
        : progress.taken === 'taken' ? variant('done', variant('taken', [...progress.runners ?? []]))
        : variant('done', variant('carried', null));
      files.set(progress.path, { path: progress.path, step, bytes: BigInt(progress.bytes), total: BigInt(progress.total) });
      if (progress.phase === 'done' || Date.now() - reportedAt >= REPORT_MS) send();
    },
    record(path, step) {
      // Migrations and index builds run a record at a time: the one before
      // has finished what it owed.
      if (active !== null && active !== path) moveTo(active, variant('done', null));
      active = path;
      moveTo(path, step);
      send();
    },
    recordsDone() {
      for (const path of records.keys()) moveTo(path, variant('done', null));
      active = null;
      send();
    },
    async settle() {
      while (sending !== null) await sending;
      settled = true;
    },
  };
}

/**
 * Check every unresolved source in a package and return the `file` ones to
 * adopt.
 *
 * @remarks
 * Called BEFORE `datasets.removeAll`, as the records' plan is: a deploy that
 * cannot succeed must leave the workspace exactly as it found it. A path this
 * process cannot read is therefore a deploy error naming the input and the
 * path — never a silently unassigned input — unless the caller passes a `warn`
 * sink, which turns it into a warning and an unassigned input.
 *
 * With `resolve` false no path is opened at all. That is the server-side half
 * of a remote deploy: a `file` source names a path on the machine that exported
 * the package, so a server reading it would adopt a file that is not the
 * client's delivery — whatever it can read at that path. Every `file` source is
 * left unassigned with a warning, and the client completes it over the transfer
 * protocol afterwards.
 *
 * @param pkg - The package being deployed
 * @param warn - When given, an unassigned `file` source is reported through
 *   this; with `resolve` on, an unreadable one warns and is left unassigned
 *   rather than failing the deploy
 * @param resolve - Whether this process reads and validates the `file` sources;
 *   false leaves every one unassigned without touching its path
 * @param files - How this process reads the files the sources name
 * @returns refPath -> the absolute file path and the type it must hold, for
 *   the sources to adopt (always empty when `resolve` is false)
 * @throws {DatasetTypeMismatchError} When a delivery's type has drifted
 * @throws {Error} When a `file` source is unreadable (and no `warn` sink is
 *   given), or names a path that is not a dataset
 */
function validateDatasetSources(
  pkg: PackageObject,
  warn: ((message: string) => void) | undefined,
  resolve: boolean,
  files: DeployFiles,
): Map<string, { file: string; declared: { subject: string; type: EastTypeValue } }> {
  const sources = new Map<string, { file: string; declared: { subject: string; type: EastTypeValue } }>();
  for (const [refPath, source] of pkg.sources) {
    const inputName = refPath.split('/').pop() ?? refPath;
    const type = recordLeafType(pkg.data.structure, refPath);
    if (!type) {
      throw new Error(`input '${inputName}': the package declares a source for '${refPath}', which is not a dataset`);
    }
    if (!resolve) {
      warn?.(
        `input '${inputName}' is left unassigned: a file source (${source.value.path}) is resolved by the ` +
        `deploying client, not by this server`
      );
      continue;
    }
    const declared = { subject: `input '${inputName}'`, type };
    const unreadable = files.check(source.value.path, declared.subject, declared.type);
    if (unreadable === null) {
      sources.set(refPath, { file: source.value.path, declared });
      continue;
    }
    if (!warn) throw unreadable.err;
    warn(
      `input '${inputName}' is left unassigned: ${unreadable.err instanceof Error ? unreadable.err.message : String(unreadable.err)}`
    );
  }
  return sources;
}

/**
 * The workspace's deployment as a deploy over it finds it: the package it has
 * deployed, and each of that package's records with the ref the workspace
 * holds and the type the package declares.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns The deployment, or null when the workspace has none
 * @throws {Error} When the deployed package or one of its record objects does
 *   not read, so its records cannot be carried forward. A deploy used to take
 *   such a workspace as never deployed, and reset every record silently.
 */
async function readPriorDeployment(
  storage: StorageBackend,
  repo: string,
  ws: string,
): Promise<PriorDeployment | null> {
  const stateBytes = await storage.refs.workspaceRead(repo, ws);
  if (stateBytes === null) return null; // no workspace yet
  const record = decodeBeast2For(WorkspaceRecordType)(stateBytes);
  if (record.type === 'none') return null; // not previously deployed

  let priorPkg: PackageObject;
  const recordObjects: RecordObject[] = [];
  try {
    priorPkg = decodePackageObject(await storage.objects.read(repo, record.value.packageHash));
    for (const recHash of priorPkg.records.values()) {
      recordObjects.push(decodeRecordObject(await storage.objects.read(repo, recHash)));
    }
  } catch (err) {
    throw new Error(
      `workspace '${ws}' has a deployment that does not read, so its records cannot be carried ` +
      `forward (${err instanceof Error ? err.message : String(err)}) — remove the workspace and deploy again`,
    );
  }

  const records: PriorDeployment['records'] = new Map();
  for (const recObj of recordObjects) {
    const ref = await storage.datasets.read(repo, ws, recObj.path);
    const type = recordLeafType(priorPkg.data.structure, recObj.path);
    if (ref && ref.type === 'value' && type) records.set(recObj.path, { ref: ref.value, type });
  }
  return { packageHash: record.value.packageHash, records };
}

/**
 * Result of exporting a workspace
 */
export interface WorkspaceExportResult {
  packageHash: string;
  objectCount: number;
  name: string;
  version: string;
  /** The zip's size in bytes. */
  bytes: number;
}

/**
 * Options for workspace export
 */
export interface WorkspaceExportOptions {
  /** Called after each object is added, or found in the zip already. Can be
   *  used for progress reporting. */
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>;
  /** External workspace lock. If not provided, an exclusive lock will be acquired internally. */
  lock?: LockHandle;
  /**
   * Aborting it stops the export once the entry it is writing is written: it
   * throws an `ExportStoppedError` holding the checkpoint it resumes from. A
   * stream is left open, holding the zip so far; a file destination of the
   * root entry's keeps it at `<path>.partial`.
   */
  signal?: AbortSignal;
  /**
   * The checkpoint a stopped export of the workspace handed over: the export
   * writes the entries after it, to a destination that holds the zip's bytes
   * up to it. The export names the version the one it resumes named, and is
   * refused when the workspace changed since.
   */
  resume?: PackageZipCheckpoint;
}

/** A run's logs, as an export carries them. */
const LOG_BYTES = new TextEncoder();

/**
 * Export a workspace as a package, to a stream.
 *
 * 1. Read workspace state
 * 2. Read deployed package structure using stored packageHash
 * 3. Create new PackageObject with current structure
 * 4. Collect all referenced objects from dataset refs
 * 5. Write the release exporting it, the objects, the package ref and the
 *    executions the current run used to the .zip — not the run's record,
 *    which names this repository's workspace
 *
 * The zip is written an entry at a time to the stream, which is closed once
 * the zip is whole, as a package's export writes it (`packageExport`), reading
 * its segments ahead of the entry it writes, and an export stopped at its
 * signal is resumed from its checkpoint. A file on this machine, or a Node
 * stream, is written to by the root entry's `workspaceExport`.
 *
 * It writes a package object that nothing in the repository names, and reads
 * what the workspace named as it started, which a write may leave unnamed
 * since: so it holds the repository's running work ({@link withRunningWork}),
 * as a package's export does, and gc holding the repository still sweeps none
 * of it, and an upgrade waits for it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param destination - The stream the zip's bytes go to
 * @param outputName - Package name (default: deployed package name)
 * @param version - Package version (default: <pkgVersion>-<short hash>)
 * @param options - Progress, the workspace lock, and the signal that stops the
 *   export and the checkpoint it resumes from
 * @returns Export result with package info and the zip's size
 * @throws {InvalidNameError} If `name` is no workspace's name, before a lock is
 *   taken
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but has no package deployed
 * @throws {ExportStoppedError} When `options.signal` stopped the export.
 * @throws {TypeError} When the destination is no `WritableStream`: a path or a
 *   Node stream, which the root entry writes to.
 * @throws {Error} When `options.resume` is given without the version, or is a
 *   checkpoint of the workspace as it was before it changed; when the stream
 *   fails a write; and when a garbage collection or an upgrade holds the
 *   repository.
 */
export async function workspaceExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  destination: WritableStream<Uint8Array>,
  outputName?: string,
  version?: string,
  options?: WorkspaceExportOptions,
): Promise<WorkspaceExportResult> {
  // Checked before the repository's running work is held, and the workspace's
  // lock taken: a lock's name may hold the `#` and `~` no workspace's may.
  checkName('workspace', name);
  const sink = zipSinkOf(destination, 'export');
  return withRunningWork(storage, repo, () => exportWorkspace(storage, repo, name, sink, outputName, version, options));
}

/** The export of {@link workspaceExport}, holding the repository's running
 *  work. */
async function exportWorkspace(
  storage: StorageBackend,
  repo: string,
  name: string,
  destination: WritableStream<Uint8Array>,
  outputName: string | undefined,
  version: string | undefined,
  options: WorkspaceExportOptions | undefined,
): Promise<WorkspaceExportResult> {
  if (options?.resume !== undefined && version === undefined) {
    throw new Error('a resumed export of a workspace names the version the export it resumes named');
  }

  // Acquire workspace lock for snapshot consistency
  const externalLock = options?.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('export', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? lockStateToHolderInfo(state) : undefined);
    }
  }
  try {

  // Get workspace state
  const state = await readStateOrThrow(storage, repo, name);

  // Read the deployed package object using the stored hash
  const deployedPkgObject = decodePackageObject(await storage.objects.read(repo, state.packageHash));

  // Determine output name and version
  const finalName = outputName ?? state.packageName;
  // For version, use a short identifier from the workspace name + timestamp
  const finalVersion = version ?? `${state.packageVersion}-${Date.now().toString(36)}`;

  // Read all workspace refs for the package
  const refList = await storage.datasets.list(repo, name);
  const workspaceRefs = new Map<string, DatasetRef>();
  for (const refPath of refList) {
    const ref = await storage.datasets.read(repo, name, refPath);
    if (ref) {
      workspaceRefs.set(refPath, ref);
    }
  }

  // Create new PackageObject with inline refs (functions and records carry
  // through unchanged — the record dataset state lives in the refs)
  const newPkgObject: PackageObject = {
    tasks: deployedPkgObject.tasks,
    data: {
      structure: deployedPkgObject.data.structure,
      refs: workspaceRefs,
    },
    functions: deployedPkgObject.functions,
    records: deployedPkgObject.records,
    // No sources: a workspace export carries the workspace's RESOLVED refs
    // (`value { hash }` plus the object bytes), so a path-initialised input
    // travels as an ordinary object and the exported package is self-contained
    // on a machine that has never seen the delivery.
    sources: new Map(),
  };

  // Encode and store the new package object
  const encoder = encodeBeast2For(PackageObjectType);
  const pkgData = encoder(newPkgObject);
  const packageHash = await storage.objects.write(repo, pkgData);

  const { objectCount, bytes } = await writePackageZip(destination, packageHash, options ?? {}, async (zip) => {
    // The release exporting it, first, so an import meets it before anything
    await zip.add(ZIP_RELEASE_ENTRY, encodeBeast2For(StringType)(E3_RELEASE));
    const objectCount = await addPackageObjects(zip, storage, repo, packageHash, newPkgObject, options?.onProgress);

    // The package ref, as a repository keeps one
    await zip.add(`packages/${finalName}/${finalVersion}.beast2`, encodeBeast2For(StringType)(packageHash));

    // Include the executions and logs of the current run. The run's own record
    // stays here: it names this repository's workspace, and a run's history
    // belongs to the repository the run ran in. The executions travel so the
    // importing repository's cache serves the outputs they made.
    if (state.currentRunId.type === 'some') {
      const currentRunId = state.currentRunId.value;
      const dataflowRun = await storage.refs.dataflowRunGet(repo, name, currentRunId);
      if (dataflowRun) {
        // Include the execution each task used, which the run's record names
        // whole: its inputs may have changed in the workspace since.
        const statusEncoder = encodeBeast2For(ExecutionStatusType);
        for (const { taskHash, inputsHash: inHash, executionId } of dataflowRun.taskExecutions.values()) {
          // Read and add execution status
          const execStatus = await storage.refs.executionGet(repo, taskHash, inHash, executionId);
          if (execStatus) {
            await zip.add(`executions/${taskHash}/${inHash}/${executionId}/status.beast2`, statusEncoder(execStatus));
          }

          // Read and add logs (stdout/stderr)
          for (const stream of ['stdout', 'stderr'] as const) {
            let log: string;
            try {
              log = (await storage.logs.read(repo, taskHash, inHash, executionId, stream, { limit: 100 * 1024 * 1024 })).data;
            } catch {
              // Skip if log not available
              continue;
            }
            if (log.length > 0) {
              await zip.add(`executions/${taskHash}/${inHash}/${executionId}/${stream}.txt`, LOG_BYTES.encode(log));
            }
          }
        }
      }
    }
    return { objectCount };
  });

  return {
    packageHash,
    objectCount,
    name: finalName,
    version: finalVersion,
    bytes,
  };

  } finally {
    if (!externalLock) {
      await lock.release();
    }
  }
}
