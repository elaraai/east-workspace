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
 */

import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import yazl from 'yazl';
import { decodeBeast2For, encodeBeast2For, equalFor, variant, none, some, EastTypeType, type EastTypeValue } from '@elaraai/east';
import { DatasetFileTypeMismatchError, readDatasetFileHeader } from '@elaraai/e3';
import { PackageObjectType, WorkspaceRecordType, RecordCommitType, DataflowRunType, DatasetRefType, decodePackageObject, decodeRecordObject, decodeTaskObject } from '@elaraai/e3-types';
import type { PackageObject, WorkspaceState, TaskObject, DatasetRef, RecordCommit, Structure, TreePath } from '@elaraai/e3-types';
import { objectAdoptFile } from './dataset-adopt.js';
import { packageResolve, packageRead, walkPackageObjects } from './packages.js';
import { writeRefsFromPackage, refPathToKeypath } from './dataset-refs.js';
import { workspaceSetDatasetByHash } from './trees.js';
import {
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceExistsError,
  WorkspaceLockError,
} from './errors.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';
import type { TaskRunner } from './execution/interfaces.js';
import { buildDeployIndexes, commitDeployIndexes, type RecordIndexPlan } from './records.js';
import { withRunningWork } from './storage/local/gc.js';

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

  const record = decodeBeast2For(WorkspaceRecordType)(Buffer.from(data));
  if (record.type === 'none') {
    return { exists: true, deployed: false };
  }
  return { exists: true, deployed: true, state: record.value };
}

/**
 * Read workspace state, throwing if workspace doesn't exist or is not deployed.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but has no package deployed
 */
async function readStateOrThrow(storage: StorageBackend, repo: string, name: string): Promise<WorkspaceState> {
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
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceLockError} If workspace is locked by another process
 */
export async function workspaceRemove(
  storage: StorageBackend,
  repo: string,
  name: string,
  options: WorkspaceRemoveOptions = {}
): Promise<void> {
  // Acquire lock if not provided externally
  const externalLock = options.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('removal', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? {
        acquiredAt: state.acquiredAt.toISOString(),
        operation: state.operation.type,
      } : undefined);
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
 * Options for workspace deployment.
 */
export interface WorkspaceDeployOptions {
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
   * Task runner for the index builds a deploy owes.
   *
   * @remarks
   * A record that declares an index needs that index built before anything can
   * read through it, and an index is built by running its program on the
   * runner its author chose. Deploy is where that debt falls due: a record
   * minted here has no index yet, and a record whose declaration changed has
   * one built under the wrong declaration.
   *
   * Omit it only where no package can declare an index: a deploy that must
   * build one without a runner is refused before it writes anything.
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
}

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
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param pkgName - Package name
 * @param pkgVersion - Package version
 * @param options - Optional settings including external lock
 * @throws {WorkspaceLockError} If workspace is locked by another process
 * @throws {Error} When a garbage collection is running in the repository
 */
export async function workspaceDeploy(
  storage: StorageBackend,
  repo: string,
  name: string,
  pkgName: string,
  pkgVersion: string,
  options: WorkspaceDeployOptions = {}
): Promise<void> {
  // Acquire lock if not provided externally
  const externalLock = options.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('deployment', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? {
        acquiredAt: state.acquiredAt.toISOString(),
        operation: state.operation.type,
      } : undefined);
    }
  }
  try {
    // Resolve package hash and read package object
    const packageHash = await packageResolve(storage, repo, pkgName, pkgVersion);
    const pkg = await packageRead(storage, repo, pkgName, pkgVersion);

    // Capture any existing record state BEFORE wiping, so a redeploy preserves
    // operational record state + audit history rather than resetting it.
    const priorRecords = await capturePriorRecords(storage, repo, name);

    // Reject an incompatible (type-changed) redeploy BEFORE any destructive
    // write, so a doomed redeploy leaves the workspace fully intact rather than
    // half-wiped with a torn state/data-dir mismatch. A path-initialised input
    // whose delivery is missing or has drifted follows the same rule: every
    // file source is validated here, before the wipe.
    await assertRecordTypesCompatible(storage, repo, pkg, priorRecords);
    const sourceFiles = validateDatasetSources(
      pkg, options.sourceWarning, options.resolveFileSources ?? true,
    );

    // The tasks lock is held from the first object this deploy writes — an
    // adopted delivery's segments, an index build's output — to the last ref
    // that names one, since until then nothing roots them against a sweep.
    await withRunningWork(storage, repo, async () => {
      // Adopt every validated delivery into the object store, still before
      // the wipe. Objects are repo-wide and content-addressed, so this is safe
      // and idempotent whatever follows (an object no ref names is gc's to
      // collect), and it moves every step that can fail for an I/O reason —
      // the hash, a cross-device copy, ENOSPC, a delivery replaced since it
      // was validated — ahead of the first destructive write. Only the ref
      // writes come after.
      const adoptedSources = new Map<string, string>();
      for (const [refPath, { file, declared }] of sourceFiles) {
        const { hash } = await objectAdoptFile(storage, repo, file, { declared });
        adoptedSources.set(refPath, hash);
      }

      // An index is derived state a deploy owes: a record minted here has
      // none, and one whose declaration changed has one built under the old
      // declaration. Every build runs before the wipe below, because a build
      // runs user East and is the step likeliest to fail; each lands as a
      // `$reindex` commit once the new refs are in place. The state each
      // record holds once the refs are written is the one writeRecordGenesis
      // writes: its preserved prior state, else the package's initial value.
      const indexBuilds = await buildDeployIndexes(storage, repo, pkg, (path) => {
        const initial = pkg.data.refs.get(path);
        if (initial?.type !== 'value') return undefined;
        const prior = priorRecords?.get(path)?.ref;
        return prior?.type === 'value' ? prior.value.hash : initial.value.hash;
      }, options.runner, options.onRecordIndex);

      // Remove any existing dataset refs
      await storage.datasets.removeAll(repo, name);

      // Initialize per-dataset ref files from the package
      await writeRefsFromPackage(storage, repo, name, pkg.data.structure, pkg.data.refs);

      // Mint each new record's genesis ($init) commit, and restore any existing
      // record's committed state and history across a redeploy. A record is
      // thus never unassigned and never silently reset.
      await writeRecordGenesis(storage, repo, name, pkg, priorRecords);
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

/**
 * Check every unresolved source in a package and return the `file` ones to
 * adopt.
 *
 * @remarks
 * Called BEFORE `datasets.removeAll`, for the reason
 * {@link assertRecordTypesCompatible} is: a deploy that cannot succeed must
 * leave the workspace exactly as it found it. A path this process cannot read
 * is therefore a deploy error naming the input and the path — never a silently
 * unassigned input — unless the caller passes a `warn` sink, which turns it
 * into a warning and an unassigned input.
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
): Map<string, { file: string; declared: { subject: string; type: EastTypeValue } }> {
  const files = new Map<string, { file: string; declared: { subject: string; type: EastTypeValue } }>();
  for (const [refPath, source] of pkg.sources) {
    const inputName = refPath.split('/').pop() ?? refPath;
    const type = datasetLeafType(pkg.data.structure, refPath);
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
    try {
      readDatasetFileHeader(source.value.path, declared.subject, declared.type);
      files.set(refPath, { file: source.value.path, declared });
    } catch (err) {
      if (!warn || err instanceof DatasetFileTypeMismatchError) throw err;
      warn(
        `input '${inputName}' is left unassigned: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return files;
}

/** The East type of the dataset leaf at a refPath (e.g. `inputs/table`). */
function datasetLeafType(structure: Structure, refPath: string): EastTypeValue | undefined {
  return recordLeafType(structure, refPath);
}

const encodeRecordCommit = encodeBeast2For(RecordCommitType);
const recordTypesEqual = equalFor(EastTypeType);

/** The East type of the record leaf at a refPath (e.g. `records/orders`). */
function recordLeafType(structure: Structure, refPath: string): EastTypeValue | undefined {
  let current: Structure = structure;
  for (const segment of refPath.split('/')) {
    if (current.type !== 'struct') return undefined;
    const next = current.value.get(segment);
    if (!next) return undefined;
    current = next;
  }
  return current.type === 'value' ? current.value.type : undefined;
}

/** A prior deployment's record refs + types, captured before a redeploy wipes
 *  the data dir, so committed state can be preserved. Null when the workspace
 *  was not previously deployed (or had no records). */
type PriorRecords = Map<string, { ref: DatasetRef; type: EastTypeValue }>;

async function capturePriorRecords(
  storage: StorageBackend,
  repo: string,
  ws: string,
): Promise<PriorRecords | null> {
  const stateBytes = await storage.refs.workspaceRead(repo, ws);
  if (stateBytes === null) return null; // no workspace yet
  let priorPkg: PackageObject;
  try {
    const record = decodeBeast2For(WorkspaceRecordType)(stateBytes);
    if (record.type === 'none') return null; // not previously deployed
    priorPkg = decodePackageObject(await storage.objects.read(repo, record.value.packageHash));
  } catch {
    return null; // unreadable prior deployment — treat as a fresh deploy
  }
  if (priorPkg.records.size === 0) return null;

  const captured: PriorRecords = new Map();
  for (const recHash of priorPkg.records.values()) {
    const recObj = decodeRecordObject(await storage.objects.read(repo, recHash));
    const ref = await storage.datasets.read(repo, ws, recObj.path);
    const type = recordLeafType(priorPkg.data.structure, recObj.path);
    if (ref && ref.type === 'value' && type) {
      captured.set(recObj.path, { ref, type });
    }
  }
  return captured.size > 0 ? captured : null;
}

/**
 * Reject a redeploy whose record changed East type, BEFORE any destructive
 * write — so the workspace is never left half-wiped. Throws on the first record
 * whose new type differs from its preserved prior type.
 */
async function assertRecordTypesCompatible(
  storage: StorageBackend,
  repo: string,
  pkg: PackageObject,
  prior: PriorRecords | null,
): Promise<void> {
  if (!prior) return;
  for (const recHash of pkg.records.values()) {
    const recObj = decodeRecordObject(await storage.objects.read(repo, recHash));
    const priorRecord = prior.get(recObj.path);
    if (!priorRecord) continue;
    const newType = recordLeafType(pkg.data.structure, recObj.path);
    if (newType && !recordTypesEqual(priorRecord.type, newType)) {
      throw new Error(
        `Cannot redeploy: record '${recObj.path}' changed type, so its committed state ` +
        `is incompatible. Remove the workspace to reset the record, or keep its type stable.`,
      );
    }
  }
}

/**
 * For each record in a freshly-deployed package: restore its prior committed
 * state + history across a redeploy when the record already existed (types were
 * checked compatible before any wipe), otherwise mint the genesis ($init)
 * commit over the package's initial value.
 *
 * The initial-state value ref was already written by writeRefsFromPackage; this
 * either overwrites it with the preserved prior ref or adds the genesis commit
 * that makes the initial state the head of the record's history. Runs under the
 * deploy lock, so unconditional ref writes are safe.
 */
async function writeRecordGenesis(
  storage: StorageBackend,
  repo: string,
  ws: string,
  pkg: PackageObject,
  prior: PriorRecords | null,
): Promise<void> {
  const at = new Date();
  for (const recHash of pkg.records.values()) {
    const recObj = decodeRecordObject(await storage.objects.read(repo, recHash));
    const stateRef = pkg.data.refs.get(recObj.path);
    if (!stateRef || stateRef.type !== 'value') continue; // a record always has initial state

    const priorRecord = prior?.get(recObj.path);
    if (priorRecord) {
      // Preserve the existing committed state and full commit chain (type was
      // already checked compatible by assertRecordTypesCompatible).
      await storage.datasets.write(repo, ws, recObj.path, priorRecord.ref);
      continue;
    }

    const commit: RecordCommit = {
      parent: none,
      state: stateRef.value.hash,
      mutation: '$init',
      args: none,
      actor: 'system:deploy',
      at,
      delta: none,
    };
    const commitHash = await storage.objects.write(repo, encodeRecordCommit(commit));
    const selfKeypath = refPathToKeypath(recObj.path);
    await storage.datasets.write(
      repo, ws, recObj.path,
      variant('value', { hash: stateRef.value.hash, versions: new Map([[selfKeypath, commitHash]]) }),
    );
  }
}

/**
 * Result of exporting a workspace
 */
export interface WorkspaceExportResult {
  packageHash: string;
  objectCount: number;
  name: string;
  version: string;
}

/**
 * Options for workspace export
 */
export interface WorkspaceExportOptions {
  /** Called after each object is added. Can be used for progress reporting. */
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>;
  /** External workspace lock. If not provided, an exclusive lock will be acquired internally. */
  lock?: LockHandle;
}

/**
 * Fixed mtime for deterministic zip output (Unix epoch)
 */
const DETERMINISTIC_MTIME = new Date(0);

/**
 * Export a workspace as a package.
 *
 * 1. Read workspace state
 * 2. Read deployed package structure using stored packageHash
 * 3. Create new PackageObject with current structure
 * 4. Collect all referenced objects from dataset refs
 * 5. Write per-dataset refs and objects to .zip
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param zipPath - Path to write the .zip file
 * @param outputName - Package name (default: deployed package name)
 * @param version - Package version (default: <pkgVersion>-<short hash>)
 * @returns Export result with package info
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but has no package deployed
 */
export async function workspaceExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  zipPath: string,
  outputName?: string,
  version?: string,
  options?: WorkspaceExportOptions,
): Promise<WorkspaceExportResult> {
  const partialPath = `${zipPath}.partial`;

  // Acquire workspace lock for snapshot consistency
  const externalLock = options?.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('export', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? {
        acquiredAt: state.acquiredAt.toISOString(),
        operation: state.operation.type,
      } : undefined);
    }
  }
  try {

  // Get workspace state
  const state = await readStateOrThrow(storage, repo, name);

  // Read the deployed package object using the stored hash
  const deployedPkgData = await storage.objects.read(repo, state.packageHash);
  const deployedPkgObject = decodePackageObject(Buffer.from(deployedPkgData));

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

  const zipfile = new yazl.ZipFile();
  let objectCount = 0;
  await walkPackageObjects(storage, repo, packageHash, newPkgObject, async (hash) => {
    const data = await storage.objects.read(repo, hash);
    zipfile.addBuffer(Buffer.from(data), `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`, { mtime: DETERMINISTIC_MTIME });
    objectCount++;
    if (options?.onProgress) await options.onProgress({ objectsProcessed: objectCount });
  });

  // Each DatasetRef as a data/ file too.
  const refEncoder = encodeBeast2For(DatasetRefType);
  for (const [refPath, ref] of workspaceRefs) {
    zipfile.addBuffer(Buffer.from(refEncoder(ref)), `data/${refPath}.ref`, { mtime: DETERMINISTIC_MTIME });
  }

  // Write the package ref
  const refPath = `packages/${finalName}/${finalVersion}`;
  zipfile.addBuffer(Buffer.from(packageHash + '\n'), refPath, { mtime: DETERMINISTIC_MTIME });

  // Include executions and logs if currentRunId exists
  if (state.currentRunId.type === 'some') {
    const currentRunId = state.currentRunId.value;
    const dataflowRun = await storage.refs.dataflowRunGet(repo, name, currentRunId);
    if (dataflowRun) {
      // Write the dataflow run record
      const runEncoder = encodeBeast2For(DataflowRunType);
      const dataflowPath = `dataflows/${name}/${currentRunId}.beast2`;
      zipfile.addBuffer(Buffer.from(runEncoder(dataflowRun)), dataflowPath, { mtime: DETERMINISTIC_MTIME });

      // Include execution files for each task
      for (const [taskName, execRecord] of dataflowRun.taskExecutions) {
        const taskHash = newPkgObject.tasks.get(taskName);
        if (!taskHash) continue;

        // Get the task to find its inputs
        const task: TaskObject = decodeTaskObject(await storage.objects.read(repo, taskHash));

        // Compute inputsHash from workspace refs
        const inputHashes: string[] = [];
        for (const { path: inputPath } of task.inputs) {
          try {
            const { workspaceGetDatasetHash } = await import('./trees.js');
            const { hash } = await workspaceGetDatasetHash(storage, repo, name, inputPath);
            if (hash) inputHashes.push(hash);
          } catch {
            // Skip if input not available
          }
        }

        if (inputHashes.length !== task.inputs.length) continue;

        const { inputsHash } = await import('./executions.js');
        const inHash = inputsHash(inputHashes);

        // Read and add execution status
        const execStatus = await storage.refs.executionGet(repo, taskHash, inHash, execRecord.executionId);
        if (execStatus) {
          const statusEncoder = await import('@elaraai/e3-types').then(m =>
            encodeBeast2For(m.ExecutionStatusType)
          );
          const statusPath = `executions/${taskHash}/${inHash}/${execRecord.executionId}/status.beast2`;
          zipfile.addBuffer(Buffer.from(statusEncoder(execStatus)), statusPath, { mtime: DETERMINISTIC_MTIME });
        }

        // Read and add logs (stdout/stderr)
        for (const stream of ['stdout', 'stderr'] as const) {
          try {
            const logChunk = await storage.logs.read(repo, taskHash, inHash, execRecord.executionId, stream, { limit: 100 * 1024 * 1024 });
            if (logChunk.data && logChunk.data.length > 0) {
              const logPath = `executions/${taskHash}/${inHash}/${execRecord.executionId}/${stream}.txt`;
              zipfile.addBuffer(Buffer.from(logChunk.data), logPath, { mtime: DETERMINISTIC_MTIME });
            }
          } catch {
            // Skip if log not available
          }
        }
      }
    }
  }

  // Finalize and write zip to disk
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(partialPath);
    zipfile.outputStream.pipe(writeStream);
    zipfile.outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);
    zipfile.end();
  });

  // Atomic rename to final path
  await fs.rename(partialPath, zipPath);

  return {
    packageHash,
    objectCount,
    name: finalName,
    version: finalVersion,
  };

  } finally {
    if (!externalLock) {
      await lock.release();
    }
  }
}
