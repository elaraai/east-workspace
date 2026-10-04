/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import {
  ExecutionOwnerType, ExecutionStatusType, DataflowRunType, RepositoryRecordType, RepositoryUpgradeProgressType, decodeExecutionStatus,
} from '@elaraai/e3-types';
import type { ExecutionOwner, ExecutionStatus, DataflowRun, RepositoryRecord, RepositoryUpgradeProgress } from '@elaraai/e3-types';
import type { RefStore } from '../interfaces.js';
import { isNotFoundError, ExecutionCorruptError, checkHash, checkId, checkName } from '../../errors.js';
import { isUuidv7 } from '../../uuid.js';
import { isObjectHash } from '../../objects.js';
import { atomicWriteFile, executionPath } from './localHelpers.js';
import { removeStaleLocks } from './LocalLockService.js';

/** A record that names an object by its hash. */
const encodeHash = encodeBeast2For(StringType);
const decodeHash = decodeBeast2For(StringType);
const encodeOwner = encodeBeast2For(ExecutionOwnerType);
const decodeOwner = decodeBeast2For(ExecutionOwnerType);

/** The repository record's file, at the repository's root. */
export const REPOSITORY_RECORD_FILE = 'repository.beast2';

/** The file of the store upgrade under way, beside the repository record:
 *  there only while a step is. */
export const REPOSITORY_UPGRADE_FILE = 'repository-upgrade.beast2';

/** Encodes a repository record as a local repository keeps it. */
export const encodeRepositoryRecord: (record: RepositoryRecord) => Uint8Array = encodeBeast2For(RepositoryRecordType);
const decodeRepositoryRecord = decodeBeast2For(RepositoryRecordType);
const encodeUpgradeProgress = encodeBeast2For(RepositoryUpgradeProgressType);
const decodeUpgradeProgress = decodeBeast2For(RepositoryUpgradeProgressType);

/**
 * Reads a record that names an object, or `null` when there is none or it is
 * not a hash: what it names becomes an object's path, so a torn or edited
 * record is none.
 */
async function readHash(file: string): Promise<string | null> {
  let data: Buffer;
  try {
    data = await fs.readFile(file);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
  try {
    const hash = decodeHash(data);
    return isObjectHash(hash) ? hash : null;
  } catch {
    return null;
  }
}

/** Removes a file, if it is there. */
async function unlinkIfPresent(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}

/**
 * Local filesystem implementation of RefStore.
 *
 * The `repo` parameter is the path to the e3 repository directory. Every
 * record is an East value in beast2:
 * - `repository.beast2`: the repository record;
 * - `repository-upgrade.beast2`: the store upgrade under way, and where its
 *   last part stopped, while one is;
 * - `packages/<name>/<version>.beast2`: a package object's hash;
 * - `workspaces/<ws>.beast2`: a workspace's record, which the caller encodes;
 * - `executions/<task>/<inputs>/<id>/status.beast2` and `owner.beast2`: an
 *   execution attempt and the orchestrator that launched it;
 * - `executions/<task>/<inputs>/plan.beast2`: the `$plan` a split task's
 *   execution is in;
 * - `adoptions/<ab>/<rest>.beast2`: the manifest a delivery became;
 * - `dataflows/<ws>/<runId>.beast2`: a run's record.
 */
export class LocalRefStore implements RefStore {
  // -------------------------------------------------------------------------
  // Repository Record
  // -------------------------------------------------------------------------

  async repositoryRead(repo: string): Promise<RepositoryRecord | null> {
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(repo, REPOSITORY_RECORD_FILE));
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
    // One that does not decode is not a record this e3 reads: an older e3
    // wrote the repository.
    try {
      return decodeRepositoryRecord(data);
    } catch {
      return null;
    }
  }

  async repositoryWrite(repo: string, record: RepositoryRecord): Promise<void> {
    await atomicWriteFile(path.join(repo, REPOSITORY_RECORD_FILE), encodeRepositoryRecord(record));
  }

  async repositoryUpgradeRead(repo: string): Promise<RepositoryUpgradeProgress | null> {
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(repo, REPOSITORY_UPGRADE_FILE));
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
    // One that does not decode says nowhere a step stopped, so the step under
    // way starts again, which a step's idempotence makes safe.
    try {
      return decodeUpgradeProgress(data);
    } catch {
      return null;
    }
  }

  async repositoryUpgradeWrite(repo: string, progress: RepositoryUpgradeProgress | null): Promise<void> {
    const file = path.join(repo, REPOSITORY_UPGRADE_FILE);
    if (progress === null) await unlinkIfPresent(file);
    else await atomicWriteFile(file, encodeUpgradeProgress(progress));
  }

  // -------------------------------------------------------------------------
  // Package References
  // -------------------------------------------------------------------------

  /** Path to a package ref: packages/<name>/<version>.beast2 */
  private packagePath(repo: string, name: string, version: string): string {
    checkName('package', name);
    checkName('package version', version);
    return path.join(repo, 'packages', name, `${version}.beast2`);
  }

  async packageList(repo: string): Promise<{ name: string; version: string }[]> {
    const packagesDir = path.join(repo, 'packages');
    const packages: { name: string; version: string }[] = [];

    try {
      const names = await fs.readdir(packagesDir);
      for (const name of names) {
        const nameDir = path.join(packagesDir, name);
        const stat = await fs.stat(nameDir);
        if (stat.isDirectory()) {
          const versions = await fs.readdir(nameDir);
          for (const version of versions) {
            // In-flight or crash-orphaned staging files end in `.partial`.
            if (!version.endsWith('.beast2')) continue;
            packages.push({ name, version: version.slice(0, -'.beast2'.length) });
          }
        }
      }
    } catch (err) {
      // Only suppress ENOENT - directory may not exist yet
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return packages;
  }

  async packageResolve(repo: string, name: string, version: string): Promise<string | null> {
    return readHash(this.packagePath(repo, name, version));
  }

  async packageWrite(repo: string, name: string, version: string, hash: string): Promise<void> {
    await atomicWriteFile(this.packagePath(repo, name, version), encodeHash(hash));
  }

  async packageRemove(repo: string, name: string, version: string): Promise<void> {
    await unlinkIfPresent(this.packagePath(repo, name, version));

    // Try to remove the package name directory if empty
    const packageDir = path.join(repo, 'packages', name);
    try {
      await fs.rmdir(packageDir);
    } catch {
      // Directory not empty, that's fine
    }
  }

  // -------------------------------------------------------------------------
  // Workspace State
  // -------------------------------------------------------------------------

  /** Path to a workspace's state: workspaces/<ws>.beast2 */
  private workspacePath(repo: string, name: string): string {
    checkName('workspace', name);
    return path.join(repo, 'workspaces', `${name}.beast2`);
  }

  async workspaceList(repo: string): Promise<string[]> {
    const workspacesDir = path.join(repo, 'workspaces');
    const names: string[] = [];

    try {
      const entries = await fs.readdir(workspacesDir);
      for (const entry of entries) {
        if (entry.endsWith('.beast2')) {
          names.push(entry.slice(0, -7)); // Remove .beast2 extension
        }
      }
    } catch (err) {
      // Only suppress ENOENT - directory may not exist yet
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return names;
  }

  async workspaceRead(repo: string, name: string): Promise<Uint8Array | null> {
    const stateFile = this.workspacePath(repo, name);

    try {
      return await fs.readFile(stateFile);
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  async workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void> {
    // Atomic stage-and-rename: a concurrent reader sees the old or new complete
    // state, never a 0-byte truncation window.
    await atomicWriteFile(this.workspacePath(repo, name), state);
  }

  /**
   * Removes a workspace: its state, and with it everything kept under its
   * name — its dataset refs and its dataflow execution state in
   * `workspaces/<ws>/`, its run records in `dataflows/<ws>/`, and the locks
   * its dataflows and dataset writes left when they exited — so none of it
   * passes to a workspace of the same name. A lock a live process holds is
   * left for it to release.
   */
  async workspaceRemove(repo: string, name: string): Promise<void> {
    await unlinkIfPresent(this.workspacePath(repo, name));
    await fs.rm(path.join(repo, 'workspaces', name), { recursive: true, force: true });
    await fs.rm(this.dataflowDir(repo, name), { recursive: true, force: true });
    // A workspace's name holds neither `#` nor `~`, which join the parts of
    // the locks named after it, so only its own begin this way.
    await removeStaleLocks(repo, (resource) => resource.startsWith(`${name}#`) || resource.startsWith(`${name}~`));
  }

  // -------------------------------------------------------------------------
  // Execution Cache (with execution history)
  // -------------------------------------------------------------------------

  async executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null> {
    const data = await this.executionReadBytes(repo, taskHash, inputsHash, executionId);
    if (data === null) {
      return null;
    }

    try {
      return decodeExecutionStatus(data);
    } catch (err) {
      throw new ExecutionCorruptError(
        taskHash,
        inputsHash,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  /** Reads the attempt's `status.beast2` as it is. */
  async executionReadBytes(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<Uint8Array | null> {
    try {
      return await fs.readFile(path.join(executionPath(repo, taskHash, inputsHash, executionId), 'status.beast2'));
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void> {
    const execDir = executionPath(repo, taskHash, inputsHash, executionId);

    // A single execution rewrites status.beast2 several times over its lifetime
    // (running → success/failed). A bare overwrite truncates the file to 0 bytes
    // mid-write, which a concurrent reader (e.g. a workspace-status poll calling
    // executionGet) decodes as "Data too short for Beast2 format". Stage-and-
    // rename makes each update atomic, so a reader only ever sees a complete
    // status object.
    const encoder = encodeBeast2For(ExecutionStatusType);
    await atomicWriteFile(path.join(execDir, 'status.beast2'), encoder(status));
  }

  /**
   * Deletes an attempt's status and owner, and then each directory it leaves
   * empty: the attempt's, its inputs', and its task's.
   */
  async executionDelete(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    const execDir = executionPath(repo, taskHash, inputsHash, executionId);
    await unlinkIfPresent(path.join(execDir, 'status.beast2'));
    await unlinkIfPresent(path.join(execDir, 'owner.beast2'));
    for (const dir of [execDir, executionPath(repo, taskHash, inputsHash), path.join(repo, 'executions', taskHash)]) {
      try {
        await fs.rmdir(dir);
      } catch {
        return; // Not empty: an attempt, a log or a plan pointer is left in it
      }
    }
  }

  async executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]> {
    const inputDir = executionPath(repo, taskHash, inputsHash);

    try {
      const entries = await fs.readdir(inputDir);
      // An attempt's directory is named by its UUIDv7, so the latest sorts last.
      return entries.filter(isUuidv7).sort();
    } catch (err) {
      if (isNotFoundError(err)) {
        return [];
      }
      throw err;
    }
  }

  async executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
    const ids = await this.executionListIds(repo, taskHash, inputsHash);
    if (ids.length === 0) {
      return null;
    }
    // Get the lexicographically greatest (latest) execution
    const latestId = ids[ids.length - 1]!;
    return this.executionGet(repo, taskHash, inputsHash, latestId);
  }

  async executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]> {
    const executionsDir = path.join(repo, 'executions');
    const result: { taskHash: string; inputsHash: string }[] = [];

    try {
      const taskDirs = await fs.readdir(executionsDir);

      for (const taskHash of taskDirs) {
        if (!isObjectHash(taskHash)) continue;

        const taskDir = path.join(executionsDir, taskHash);
        const stat = await fs.stat(taskDir);
        if (!stat.isDirectory()) continue;

        const inputsDirs = await fs.readdir(taskDir);
        for (const inputsHash of inputsDirs) {
          if (isObjectHash(inputsHash)) {
            result.push({ taskHash, inputsHash });
          }
        }
      }
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return result;
  }

  async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
    checkHash('task hash', taskHash);
    const taskDir = path.join(repo, 'executions', taskHash);

    try {
      const entries = await fs.readdir(taskDir);
      return entries.filter(isObjectHash);
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
      return [];
    }
  }

  async executionListLatest(repo: string, taskHash: string): Promise<Array<{ inputsHash: string; status: ExecutionStatus }>> {
    // Local FS: compose from per-inputsHash lookups, in parallel — directory
    // reads are cheap here; the single-round-trip contract matters for
    // remote backends.
    const inputsHashes = await this.executionListForTask(repo, taskHash);
    const entries = await Promise.all(
      inputsHashes.map(async (inputsHash) => {
        const status = await this.executionGetLatest(repo, taskHash, inputsHash);
        return status ? { inputsHash, status } : null;
      })
    );
    return entries.filter((e): e is { inputsHash: string; status: ExecutionStatus } => e !== null);
  }

  /**
   * Writes the owner record: executions/<taskHash>/<inputsHash>/<executionId>/owner.beast2
   */
  async executionOwnerWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, owner: ExecutionOwner): Promise<void> {
    await atomicWriteFile(path.join(executionPath(repo, taskHash, inputsHash, executionId), 'owner.beast2'), encodeOwner(owner));
  }

  async executionOwnerRead(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionOwner | null> {
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(executionPath(repo, taskHash, inputsHash, executionId), 'owner.beast2'));
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
    // The owner is advisory: one that does not decode is treated as
    // unrecorded, so the stale-`running` repair — which needs a recorded, dead
    // owner — leaves the execution alone.
    try {
      return decodeOwner(data);
    } catch {
      return null;
    }
  }

  /**
   * Writes the plan pointer: executions/<taskHash>/<inputsHash>/plan.beast2,
   * the `$plan`'s hash, or removes it to clear it.
   */
  async executionPlanWrite(repo: string, taskHash: string, inputsHash: string, planHash: string | null): Promise<void> {
    const file = path.join(executionPath(repo, taskHash, inputsHash), 'plan.beast2');
    if (planHash === null) await unlinkIfPresent(file);
    else await atomicWriteFile(file, encodeHash(planHash));
  }

  async executionPlanRead(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    return readHash(path.join(executionPath(repo, taskHash, inputsHash), 'plan.beast2'));
  }

  // -------------------------------------------------------------------------
  // Adoption Memo
  // -------------------------------------------------------------------------

  /**
   * Path to an adoption memo entry: adoptions/<hash[0..2]>/<hash[2..]>.beast2,
   * or null for a name that is not a SHA-256 in lowercase hex — a client names
   * the hash a transfer init asks after, so nothing else is joined into a path.
   */
  private adoptionPath(repo: string, sourceHash: string): string | null {
    if (!isObjectHash(sourceHash)) return null;
    return path.join(repo, 'adoptions', sourceHash.slice(0, 2), `${sourceHash.slice(2)}.beast2`);
  }

  async adoptionWrite(repo: string, sourceHash: string, manifestHash: string): Promise<void> {
    checkHash('object hash', sourceHash);
    await atomicWriteFile(this.adoptionPath(repo, sourceHash)!, encodeHash(manifestHash));
  }

  async adoptionRead(repo: string, sourceHash: string): Promise<string | null> {
    const entry = this.adoptionPath(repo, sourceHash);
    return entry === null ? null : readHash(entry);
  }

  async adoptionList(repo: string): Promise<Array<{ sourceHash: string; manifestHash: string | null }>> {
    const root = path.join(repo, 'adoptions');
    const listed: Array<{ sourceHash: string; manifestHash: string | null }> = [];
    let prefixes: string[];
    try {
      prefixes = await fs.readdir(root);
    } catch (err) {
      if (isNotFoundError(err)) return listed;
      throw err;
    }
    for (const prefix of prefixes) {
      let names: string[];
      try {
        names = await fs.readdir(path.join(root, prefix));
      } catch (err) {
        if (isNotFoundError(err) || (err as NodeJS.ErrnoException).code === 'ENOTDIR') continue;
        throw err;
      }
      for (const name of names) {
        // In-flight or crash-orphaned staging files end in `.partial`.
        if (!name.endsWith('.beast2')) continue;
        const sourceHash = `${prefix}${name.slice(0, -'.beast2'.length)}`;
        if (!isObjectHash(sourceHash)) continue;
        listed.push({ sourceHash, manifestHash: await readHash(path.join(root, prefix, name)) });
      }
    }
    return listed;
  }

  /** Removes an entry. Its directory is left, even once empty: removing it
   *  could race another entry's write into it. */
  async adoptionDelete(repo: string, sourceHash: string): Promise<void> {
    const entry = this.adoptionPath(repo, sourceHash);
    if (entry !== null) await unlinkIfPresent(entry);
  }

  // -------------------------------------------------------------------------
  // Dataflow Run History
  // -------------------------------------------------------------------------

  private dataflowDir(repo: string, workspace: string): string {
    checkName('workspace', workspace);
    return path.join(repo, 'dataflows', workspace);
  }

  /** A run's record, named by its id, a UUIDv7 — which a package being
   *  imported names, so nothing else becomes a path. */
  private dataflowRunPath(repo: string, workspace: string, runId: string): string {
    checkId('run id', runId);
    return path.join(this.dataflowDir(repo, workspace), `${runId}.beast2`);
  }

  async dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null> {
    const runPath = this.dataflowRunPath(repo, workspace, runId);

    let data: Buffer;
    try {
      data = await fs.readFile(runPath);
    } catch (err) {
      if (isNotFoundError(err)) {
        return null;
      }
      throw err;
    }

    const decoder = decodeBeast2For(DataflowRunType);
    return decoder(data);
  }

  async dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void> {
    // A run record is rewritten in place as the run progresses (initial →
    // cancelled/final); stage-and-rename so a concurrent dataflowRunGet never
    // observes a 0-byte truncation window.
    const encoder = encodeBeast2For(DataflowRunType);
    const runPath = this.dataflowRunPath(repo, workspace, run.runId);
    await atomicWriteFile(runPath, encoder(run));
  }

  async dataflowRunList(repo: string, workspace: string): Promise<string[]> {
    const dir = this.dataflowDir(repo, workspace);

    try {
      const entries = await fs.readdir(dir);
      // Filter for .beast2 files, extract runId, and sort
      return entries
        .filter((e) => e.endsWith('.beast2'))
        .map((e) => e.slice(0, -7))  // Remove .beast2
        .filter(isUuidv7)
        .sort();
    } catch (err) {
      if (isNotFoundError(err)) {
        return [];
      }
      throw err;
    }
  }

  async dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null> {
    const ids = await this.dataflowRunList(repo, workspace);
    if (ids.length === 0) {
      return null;
    }
    const latestId = ids[ids.length - 1]!;
    return this.dataflowRunGet(repo, workspace, latestId);
  }

  async dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void> {
    await unlinkIfPresent(this.dataflowRunPath(repo, workspace, runId));
  }
}
