/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { encodeBeast2For, none, variant } from '@elaraai/east';
import { ExecutionStatusType, decodeExecutionStatus } from '@elaraai/e3-types';
import { computeHash } from '../../objects.js';
import { ExecutionCorruptError, ObjectNotFoundError, RepoNotFoundError, DatasetRefConflictError, checkHash, checkId } from '../../errors.js';
import type { ExecutionOwner, ExecutionStatus, DataflowRun, DatasetRef, LockHolderVariant, RepositoryRecord } from '@elaraai/e3-types';
import type {
  StorageBackend,
  ObjectStore,
  RefStore,
  DatasetRefStore,
  GcObjectEntry,
  LockService,
  LockHandle,
  LockOperation,
  LockProgress,
  LockState,
  LogStore,
  LogChunk,
  RepositoryUpgrade,
} from '../interfaces.js';
import { completeUtf8Length } from '../utf8.js';
import { InMemoryStateStore } from '../../dataflow/state-store/InMemoryStateStore.js';
import type { ExecutionStateStore } from '../../dataflow/state-store/interfaces.js';
import { InMemoryRepoStore, type InMemoryRepositoryRecords } from './InMemoryRepoStore.js';

/** An object as the in-memory store holds it: its bytes, when it was last
 *  written or re-referenced, and gc's unreachable note, when one stands. */
interface HeldObject {
  data: Uint8Array;
  writtenAt: number;
  unreachableSince: number | null;
}

/**
 * In-memory implementation of ObjectStore for testing.
 *
 * It keeps when it last wrote or re-referenced each object, as a file keeps
 * its mtime, so gc's age gate spares an object written a moment ago; and gc's
 * unreachable note beside it, as a catalogue row would, so a write or a touch
 * clears the note in the same step.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryObjectStore implements ObjectStore {
  /** Objects are held apart from any file, as a store elsewhere holds them:
   *  placing one writes its bytes. */
  readonly placement = 'download';

  private objects = new Map<string, Map<string, HeldObject>>();

  private getRepoObjects(repo: string): Map<string, HeldObject> {
    let repoObjects = this.objects.get(repo);
    if (!repoObjects) {
      repoObjects = new Map();
      this.objects.set(repo, repoObjects);
    }
    return repoObjects;
  }

  async write(repo: string, data: Uint8Array): Promise<string> {
    const hash = computeHash(data);
    this.getRepoObjects(repo).set(hash, { data, writtenAt: Date.now(), unreachableSince: null });
    return hash;
  }

  async touch(repo: string, hashes: readonly string[]): Promise<boolean[]> {
    for (const hash of hashes) checkHash('object hash', hash);
    const repoObjects = this.getRepoObjects(repo);
    return hashes.map((hash) => {
      const object = repoObjects.get(hash);
      if (object === undefined) return false;
      object.writtenAt = Date.now();
      object.unreachableSince = null;
      return true;
    });
  }

  async writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return this.write(repo, data);
  }

  async read(repo: string, hash: string): Promise<Uint8Array> {
    checkHash('object hash', hash);
    const object = this.getRepoObjects(repo).get(hash);
    if (!object) {
      throw new ObjectNotFoundError(hash);
    }
    return object.data;
  }

  async readRange(repo: string, hash: string, offset: number, length: number): Promise<Uint8Array> {
    checkHash('object hash', hash);
    const object = this.getRepoObjects(repo).get(hash);
    if (!object) {
      throw new ObjectNotFoundError(hash);
    }
    return object.data.subarray(offset, offset + length);
  }

  async adoptFile(repo: string, file: string, hash?: string): Promise<{ hash: string; size: number }> {
    if (hash !== undefined) checkHash('object hash', hash);
    const data = new Uint8Array(await readFile(file));
    const digest = await this.write(repo, data);
    if (hash !== undefined && hash !== digest) {
      throw new Error(`adoptFile: ${file} hashes to ${digest}, not the ${hash} it was adopted as`);
    }
    return { hash: digest, size: data.length };
  }

  async materialize(repo: string, hash: string, destPath: string): Promise<void> {
    await writeFile(destPath, await this.read(repo, hash));
  }

  async exists(repo: string, hash: string): Promise<boolean> {
    checkHash('object hash', hash);
    return this.getRepoObjects(repo).has(hash);
  }

  async stat(repo: string, hash: string): Promise<{ size: number }> {
    checkHash('object hash', hash);
    const object = this.getRepoObjects(repo).get(hash);
    if (!object) {
      throw new ObjectNotFoundError(hash);
    }
    return { size: object.data.length };
  }

  async list(repo: string): Promise<string[]> {
    return [...this.getRepoObjects(repo).keys()];
  }

  async count(repo: string): Promise<number> {
    return this.getRepoObjects(repo).size;
  }

  /** Every object of a repository, with its size, when it was last written
   *  or re-referenced, and its unreachable note: what gc's object scan lists. */
  gcEntries(repo: string): GcObjectEntry[] {
    return [...this.getRepoObjects(repo)].map(([hash, { data, writtenAt, unreachableSince }]) => ({
      hash, lastModified: writtenAt, size: data.length, unreachableSince,
    }));
  }

  /** Deletes a repository's objects; one already gone is passed over. */
  gcDelete(repo: string, hashes: readonly string[]): void {
    for (const hash of hashes) checkHash('object hash', hash);
    const repoObjects = this.getRepoObjects(repo);
    for (const hash of hashes) repoObjects.delete(hash);
  }

  /** Notes objects unreachable at `at`, keeping a note that stands, and
   *  answers each note's time. */
  gcNote(repo: string, hashes: readonly string[], at: number): number[] {
    for (const hash of hashes) checkHash('object hash', hash);
    const repoObjects = this.getRepoObjects(repo);
    return hashes.map((hash) => {
      const object = repoObjects.get(hash);
      if (object === undefined) return at;
      object.unreachableSince ??= at;
      return object.unreachableSince;
    });
  }

  /** Clears the unreachable notes of objects. */
  gcClear(repo: string, hashes: readonly string[]): void {
    for (const hash of hashes) checkHash('object hash', hash);
    const repoObjects = this.getRepoObjects(repo);
    for (const hash of hashes) {
      const object = repoObjects.get(hash);
      if (object !== undefined) object.unreachableSince = null;
    }
  }

  /** Deletes an object while its note stands at `since`, and says whether it
   *  did. */
  gcDeleteIf(repo: string, hash: string, since: number): boolean {
    checkHash('object hash', hash);
    const repoObjects = this.getRepoObjects(repo);
    if (repoObjects.get(hash)?.unreachableSince !== since) return false;
    return repoObjects.delete(hash);
  }

  clear(): void {
    this.objects.clear();
  }
}

/**
 * An execution attempt's record as the in-memory store holds it: the status
 * written, or bytes a test left, as an earlier release or a crash leaves a
 * stored record.
 */
type HeldExecution = { readonly status: ExecutionStatus } | { readonly bytes: Uint8Array };

const encodeStatus = encodeBeast2For(ExecutionStatusType);

/** What a damaged record holds unless its test gives bytes: no record. */
const NOT_A_RECORD = new TextEncoder().encode('not a record');

/**
 * In-memory implementation of RefStore for testing.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryRefStore implements RefStore, InMemoryRepositoryRecords {
  // repository records keyed by repo
  private repositories = new Map<string, RepositoryRecord>();
  private packages = new Map<string, Map<string, string>>();
  private workspaces = new Map<string, Map<string, Uint8Array>>();
  // executions now keyed by taskHash/inputsHash/executionId
  private executions = new Map<string, Map<string, HeldExecution>>();
  // dataflow runs keyed by workspace/runId
  private dataflowRuns = new Map<string, Map<string, DataflowRun>>();
  // owner sidecars keyed by repo/taskHash/inputsHash/executionId
  private owners = new Map<string, ExecutionOwner>();
  // plan sidecars keyed by repo/taskHash/inputsHash
  private plans = new Map<string, string>();
  // adoption memo entries keyed by repo/sourceHash
  private adoptions = new Map<string, string>();

  /**
   * @param runStates - The backend's runs' states, which a workspace's removal
   *   removes with its records
   */
  constructor(private readonly runStates: InMemoryStateStore) {}

  private getPackages(repo: string): Map<string, string> {
    let repoPackages = this.packages.get(repo);
    if (!repoPackages) {
      repoPackages = new Map();
      this.packages.set(repo, repoPackages);
    }
    return repoPackages;
  }

  private getWorkspaces(repo: string): Map<string, Uint8Array> {
    let repoWorkspaces = this.workspaces.get(repo);
    if (!repoWorkspaces) {
      repoWorkspaces = new Map();
      this.workspaces.set(repo, repoWorkspaces);
    }
    return repoWorkspaces;
  }

  private getExecutions(repo: string): Map<string, HeldExecution> {
    let repoExecutions = this.executions.get(repo);
    if (!repoExecutions) {
      repoExecutions = new Map();
      this.executions.set(repo, repoExecutions);
    }
    return repoExecutions;
  }

  private getDataflowRuns(repo: string): Map<string, DataflowRun> {
    let repoRuns = this.dataflowRuns.get(repo);
    if (!repoRuns) {
      repoRuns = new Map();
      this.dataflowRuns.set(repo, repoRuns);
    }
    return repoRuns;
  }

  private makePackageKey(name: string, version: string): string {
    return `${name}@${version}`;
  }

  private makeExecutionKey(taskHash: string, inputsHash: string, executionId: string): string {
    return `${taskHash}/${inputsHash}/${executionId}`;
  }

  private makeInputsKey(taskHash: string, inputsHash: string): string {
    return `${taskHash}/${inputsHash}`;
  }

  private makeDataflowRunKey(workspace: string, runId: string): string {
    return `${workspace}/${runId}`;
  }

  /** Refuses an execution's hashes, and its id when given, that are not of
   *  their form, as every store does before it makes a key of them. */
  private checkExecution(taskHash: string, inputsHash: string, executionId?: string): void {
    checkHash('task hash', taskHash);
    checkHash('inputs hash', inputsHash);
    if (executionId !== undefined) checkId('execution id', executionId);
  }

  // Repository record
  async repositoryRead(repo: string): Promise<RepositoryRecord | null> {
    return this.repositories.get(repo) ?? null;
  }

  async repositoryWrite(repo: string, record: RepositoryRecord): Promise<void> {
    this.repositories.set(repo, record);
  }

  // Package operations
  async packageList(repo: string): Promise<{ name: string; version: string }[]> {
    const result: { name: string; version: string }[] = [];
    for (const key of this.getPackages(repo).keys()) {
      const [name, version] = key.split('@');
      result.push({ name: name!, version: version! });
    }
    return result;
  }

  async packageResolve(repo: string, name: string, version: string): Promise<string | null> {
    return this.getPackages(repo).get(this.makePackageKey(name, version)) ?? null;
  }

  async packageWrite(repo: string, name: string, version: string, hash: string): Promise<void> {
    this.getPackages(repo).set(this.makePackageKey(name, version), hash);
  }

  async packageRemove(repo: string, name: string, version: string): Promise<void> {
    this.getPackages(repo).delete(this.makePackageKey(name, version));
  }

  // Workspace operations
  async workspaceList(repo: string): Promise<string[]> {
    return [...this.getWorkspaces(repo).keys()];
  }

  async workspaceRead(repo: string, name: string): Promise<Uint8Array | null> {
    return this.getWorkspaces(repo).get(name) ?? null;
  }

  async workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void> {
    this.getWorkspaces(repo).set(name, state);
  }

  async workspaceRemove(repo: string, name: string): Promise<void> {
    this.getWorkspaces(repo).delete(name);
    for (const runId of await this.dataflowRunList(repo, name)) {
      await this.dataflowRunDelete(repo, name, runId);
    }
    this.runStates.removeWorkspace(repo, name);
  }

  // Execution operations (with executionId)
  async executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null> {
    this.checkExecution(taskHash, inputsHash, executionId);
    const held = this.getExecutions(repo).get(this.makeExecutionKey(taskHash, inputsHash, executionId));
    if (held === undefined) return null;
    if ('status' in held) return held.status;
    try {
      return decodeExecutionStatus(held.bytes);
    } catch (err) {
      throw new ExecutionCorruptError(taskHash, inputsHash, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Reads a record as a store of bytes would: the bytes a test left, or the
   *  status written, encoded. */
  async executionReadBytes(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<Uint8Array | null> {
    this.checkExecution(taskHash, inputsHash, executionId);
    const held = this.getExecutions(repo).get(this.makeExecutionKey(taskHash, inputsHash, executionId));
    if (held === undefined) return null;
    return 'bytes' in held ? held.bytes : encodeStatus(held.status);
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void> {
    this.checkExecution(taskHash, inputsHash, executionId);
    this.getExecutions(repo).set(this.makeExecutionKey(taskHash, inputsHash, executionId), { status });
  }

  /**
   * Leaves an execution attempt's record in bytes, as a crash or a failing
   * disk leaves one, or an earlier release left one in its form: a test's,
   * for the cases of such a record. The record is there, and listed, from
   * then on, and a write of it replaces it.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - The attempt's id
   * @param bytes - The record's bytes: bytes that do not decode as one unless
   *   given
   */
  damageExecution(repo: string, taskHash: string, inputsHash: string, executionId: string, bytes: Uint8Array = NOT_A_RECORD): void {
    this.getExecutions(repo).set(this.makeExecutionKey(taskHash, inputsHash, executionId), { bytes });
  }

  async executionDelete(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    this.checkExecution(taskHash, inputsHash, executionId);
    const key = this.makeExecutionKey(taskHash, inputsHash, executionId);
    this.getExecutions(repo).delete(key);
    this.owners.delete(`${repo}/${key}`);
  }

  async executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]> {
    this.checkExecution(taskHash, inputsHash);
    const prefix = this.makeInputsKey(taskHash, inputsHash) + '/';
    const ids: string[] = [];
    for (const key of this.getExecutions(repo).keys()) {
      if (key.startsWith(prefix)) {
        ids.push(key.slice(prefix.length));
      }
    }
    return ids.sort();
  }

  async executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
    const ids = await this.executionListIds(repo, taskHash, inputsHash);
    if (ids.length === 0) return null;
    const latestId = ids[ids.length - 1]!;
    return this.executionGet(repo, taskHash, inputsHash, latestId);
  }

  async executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]> {
    const seen = new Set<string>();
    const result: { taskHash: string; inputsHash: string }[] = [];
    for (const key of this.getExecutions(repo).keys()) {
      const parts = key.split('/');
      const inputsKey = `${parts[0]}/${parts[1]}`;
      if (!seen.has(inputsKey)) {
        seen.add(inputsKey);
        result.push({ taskHash: parts[0]!, inputsHash: parts[1]! });
      }
    }
    return result;
  }

  async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
    checkHash('task hash', taskHash);
    const seen = new Set<string>();
    for (const key of this.getExecutions(repo).keys()) {
      if (key.startsWith(`${taskHash}/`)) {
        const parts = key.split('/');
        seen.add(parts[1]!);
      }
    }
    return [...seen];
  }

  async executionListLatest(repo: string, taskHash: string): Promise<Array<{ inputsHash: string; status: ExecutionStatus }>> {
    const result: Array<{ inputsHash: string; status: ExecutionStatus }> = [];
    for (const inputsHash of await this.executionListForTask(repo, taskHash)) {
      const status = await this.executionGetLatest(repo, taskHash, inputsHash);
      if (status) result.push({ inputsHash, status });
    }
    return result;
  }

  async executionOwnerWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, owner: ExecutionOwner): Promise<void> {
    this.checkExecution(taskHash, inputsHash, executionId);
    this.owners.set(`${repo}/${this.makeExecutionKey(taskHash, inputsHash, executionId)}`, owner);
  }

  async executionOwnerRead(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionOwner | null> {
    this.checkExecution(taskHash, inputsHash, executionId);
    return this.owners.get(`${repo}/${this.makeExecutionKey(taskHash, inputsHash, executionId)}`) ?? null;
  }

  async executionPlanWrite(repo: string, taskHash: string, inputsHash: string, planHash: string | null): Promise<void> {
    this.checkExecution(taskHash, inputsHash);
    const key = `${repo}/${this.makeInputsKey(taskHash, inputsHash)}`;
    if (planHash === null) {
      this.plans.delete(key);
    } else {
      this.plans.set(key, planHash);
    }
  }

  async executionPlanRead(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    this.checkExecution(taskHash, inputsHash);
    return this.plans.get(`${repo}/${this.makeInputsKey(taskHash, inputsHash)}`) ?? null;
  }

  async adoptionWrite(repo: string, sourceHash: string, manifestHash: string): Promise<void> {
    checkHash('object hash', sourceHash);
    this.adoptions.set(`${repo}/${sourceHash}`, manifestHash);
  }

  async adoptionRead(repo: string, sourceHash: string): Promise<string | null> {
    return this.adoptions.get(`${repo}/${sourceHash}`) ?? null;
  }

  async adoptionList(repo: string): Promise<Array<{ sourceHash: string; manifestHash: string | null }>> {
    const prefix = `${repo}/`;
    return [...this.adoptions]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, manifestHash]) => ({ sourceHash: key.slice(prefix.length), manifestHash }));
  }

  async adoptionDelete(repo: string, sourceHash: string): Promise<void> {
    this.adoptions.delete(`${repo}/${sourceHash}`);
  }

  // Dataflow run operations
  async dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null> {
    checkId('run id', runId);
    return this.getDataflowRuns(repo).get(this.makeDataflowRunKey(workspace, runId)) ?? null;
  }

  async dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void> {
    checkId('run id', run.runId);
    this.getDataflowRuns(repo).set(this.makeDataflowRunKey(workspace, run.runId), run);
  }

  async dataflowRunList(repo: string, workspace: string): Promise<string[]> {
    const prefix = `${workspace}/`;
    const ids: string[] = [];
    for (const key of this.getDataflowRuns(repo).keys()) {
      if (key.startsWith(prefix)) {
        ids.push(key.slice(prefix.length));
      }
    }
    return ids.sort();
  }

  async dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null> {
    const ids = await this.dataflowRunList(repo, workspace);
    if (ids.length === 0) return null;
    const latestId = ids[ids.length - 1]!;
    return this.dataflowRunGet(repo, workspace, latestId);
  }

  async dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void> {
    checkId('run id', runId);
    const key = this.makeDataflowRunKey(workspace, runId);
    this.getDataflowRuns(repo).delete(key);
  }

  drop(repo: string): number {
    let dropped = this.repositories.delete(repo) ? 1 : 0;
    for (const records of [this.packages, this.workspaces, this.executions, this.dataflowRuns]) {
      dropped += records.get(repo)?.size ?? 0;
      records.delete(repo);
    }
    for (const records of [this.owners, this.plans, this.adoptions]) {
      for (const key of [...records.keys()]) {
        if (key.startsWith(`${repo}/`)) {
          records.delete(key);
          dropped++;
        }
      }
    }
    return dropped;
  }

  clear(): void {
    this.repositories.clear();
    this.packages.clear();
    this.workspaces.clear();
    this.executions.clear();
    this.dataflowRuns.clear();
    this.owners.clear();
    this.plans.clear();
    this.adoptions.clear();
  }
}

/**
 * In-memory implementation of LockService for testing.
 *
 * Supports shared/exclusive lock modes:
 * - Multiple shared holders can coexist on the same resource
 * - Exclusive locks require zero holders
 * - Shared locks fail if an exclusive holder exists
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryLockService implements LockService, InMemoryRepositoryRecords {
  // Track exclusive locks (at most one per resource)
  private exclusiveLocks = new Map<string, LockState>();
  // Track shared lock count per resource
  private sharedLockCounts = new Map<string, number>();
  // What each exclusive holder last reported of its progress
  private progress = new Map<string, LockProgress>();

  private makeLockKey(repo: string, resource: string): string {
    return `${repo}:${resource}`;
  }

  async acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' }
  ): Promise<LockHandle | null> {
    // A waiting acquire polls until the lock is free or its time is up, as the
    // local service's does, with the same default timeout.
    const deadline = Date.now() + (options?.wait === true ? (options.timeout ?? 30_000) : 0);
    for (;;) {
      const handle = this.tryAcquire(repo, resource, operation, options?.mode ?? 'exclusive');
      if (handle !== null || Date.now() >= deadline) return handle;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Takes the lock if it is free in `mode`, or returns null. */
  private tryAcquire(repo: string, resource: string, operation: LockOperation, mode: 'shared' | 'exclusive'): LockHandle | null {
    const key = this.makeLockKey(repo, resource);

    if (mode === 'shared') {
      // Shared mode: fail if exclusive lock is held
      if (this.exclusiveLocks.has(key)) {
        return null;
      }
      // Increment shared count
      const count = this.sharedLockCounts.get(key) ?? 0;
      this.sharedLockCounts.set(key, count + 1);

      let released = false;
      return {
        resource,
        // A shared holder's report is not kept: progress is the exclusive holder's.
        report: async () => {},
        release: async () => {
          if (released) return;
          released = true;
          const current = this.sharedLockCounts.get(key) ?? 0;
          if (current <= 1) {
            this.sharedLockCounts.delete(key);
          } else {
            this.sharedLockCounts.set(key, current - 1);
          }
        },
      };
    } else {
      // Exclusive mode: fail if any lock (shared or exclusive) is held
      if (this.exclusiveLocks.has(key)) {
        return null;
      }
      if ((this.sharedLockCounts.get(key) ?? 0) > 0) {
        return null;
      }

      const now = new Date();
      const state: LockState = {
        holder: variant('process', { pid: BigInt(process.pid), bootId: 'in-memory', startTime: 0n, command: 'test' }),
        operation,
        acquiredAt: now,
        expiresAt: none,
      };
      this.exclusiveLocks.set(key, state);

      let released = false;
      return {
        resource,
        report: async (progress: LockProgress) => {
          if (!released) this.progress.set(key, progress);
        },
        release: async () => {
          if (released) return;
          released = true;
          this.progress.delete(key);
          this.exclusiveLocks.delete(key);
        },
      };
    }
  }

  async getState(repo: string, resource: string): Promise<LockState | null> {
    return this.exclusiveLocks.get(this.makeLockKey(repo, resource)) ?? null;
  }

  async getProgress(repo: string, resource: string): Promise<LockProgress | null> {
    const key = this.makeLockKey(repo, resource);
    return this.exclusiveLocks.has(key) ? this.progress.get(key) ?? null : null;
  }

  async isHolderAlive(_holder: LockHolderVariant): Promise<boolean> {
    return true;
  }

  drop(repo: string): number {
    let dropped = 0;
    for (const locks of [this.exclusiveLocks, this.sharedLockCounts, this.progress]) {
      for (const key of [...locks.keys()]) {
        if (key.startsWith(`${repo}:`)) {
          locks.delete(key);
          dropped++;
        }
      }
    }
    return dropped;
  }

  clear(): void {
    this.exclusiveLocks.clear();
    this.sharedLockCounts.clear();
    this.progress.clear();
  }
}

/**
 * In-memory implementation of LogStore for testing.
 *
 * A log is kept as its UTF-8 bytes and read a window of bytes at a time, as a
 * local log file is: a window stops short of a character its end would split,
 * unless it reaches the log's end.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryLogStore implements LogStore, InMemoryRepositoryRecords {
  private logs = new Map<string, Uint8Array>();

  /** Refuses an attempt's hashes and id when they are not of their form, as
   *  every store refuses them before it makes a key of them. */
  private checkAttempt(taskHash: string, inputsHash: string, executionId: string): void {
    checkHash('task hash', taskHash);
    checkHash('inputs hash', inputsHash);
    checkId('execution id', executionId);
  }

  /** A log's key, its attempt's names checked. */
  private makeLogKey(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: string): string {
    this.checkAttempt(taskHash, inputsHash, executionId);
    return `${repo}:${taskHash}:${inputsHash}:${executionId}:${stream}`;
  }

  async append(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void> {
    const key = this.makeLogKey(repo, taskHash, inputsHash, executionId, stream);
    const existing = this.logs.get(key) ?? new Uint8Array(0);
    const added = new TextEncoder().encode(data);
    const log = new Uint8Array(existing.length + added.length);
    log.set(existing);
    log.set(added, existing.length);
    this.logs.set(key, log);
  }

  async read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk> {
    const log = this.logs.get(this.makeLogKey(repo, taskHash, inputsHash, executionId, stream));
    if (log === undefined) {
      return { data: '', offset: 0, size: 0, totalSize: 0, complete: true };
    }
    const offset = options?.offset ?? 0;
    const window = log.subarray(offset, offset + (options?.limit ?? 65536));
    const size = offset + window.length >= log.length ? window.length : completeUtf8Length(window) || window.length;
    return {
      data: new TextDecoder().decode(window.subarray(0, size)),
      offset,
      size,
      totalSize: log.length,
      complete: offset + size >= log.length,
    };
  }

  /** Holds nothing to flush: an append is in the log once it resolves. The
   *  attempt's names are checked all the same, as every method checks them. */
  async flush(_repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    this.checkAttempt(taskHash, inputsHash, executionId);
  }

  async remove(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void> {
    for (const stream of ['stdout', 'stderr']) {
      this.logs.delete(this.makeLogKey(repo, taskHash, inputsHash, executionId, stream));
    }
  }

  drop(repo: string): number {
    let dropped = 0;
    for (const key of [...this.logs.keys()]) {
      if (key.startsWith(`${repo}:`)) {
        this.logs.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  clear(): void {
    this.logs.clear();
  }
}

/**
 * In-memory implementation of DatasetRefStore for testing.
 */
/* eslint-disable @typescript-eslint/require-await */
class InMemoryDatasetRefStore implements DatasetRefStore, InMemoryRepositoryRecords {
  // Key: "repo:ws:path" -> ref plus its current revision token.
  private refs = new Map<string, { ref: DatasetRef; revision: string }>();
  // Monotonic counter minting opaque revision tokens. Distinct per write, so a
  // CAS never misses a concurrent change even when two writes produce equal refs.
  private revCounter = 0;

  private makeKey(repo: string, ws: string, path: string): string {
    return `${repo}:${ws}:${path}`;
  }

  private makePrefix(repo: string, ws: string): string {
    return `${repo}:${ws}:`;
  }

  private nextRevision(): string {
    return String(++this.revCounter);
  }

  async read(repo: string, ws: string, path: string): Promise<DatasetRef | null> {
    return this.refs.get(this.makeKey(repo, ws, path))?.ref ?? null;
  }

  async write(repo: string, ws: string, path: string, ref: DatasetRef): Promise<void> {
    this.refs.set(this.makeKey(repo, ws, path), { ref, revision: this.nextRevision() });
  }

  async readVersioned(repo: string, ws: string, path: string): Promise<{ ref: DatasetRef; revision: string } | null> {
    const entry = this.refs.get(this.makeKey(repo, ws, path));
    return entry ? { ref: entry.ref, revision: entry.revision } : null;
  }

  // Single-threaded: the read-compare-set runs with no intervening await, so it
  // is atomic against other concurrent writeIf/write calls on this store.
  async writeIf(
    repo: string,
    ws: string,
    path: string,
    ref: DatasetRef,
    expectedRevision: string | null
  ): Promise<{ revision: string }> {
    const key = this.makeKey(repo, ws, path);
    const currentRevision = this.refs.get(key)?.revision ?? null;
    if (currentRevision !== expectedRevision) {
      throw new DatasetRefConflictError(ws, path, expectedRevision, currentRevision);
    }
    const revision = this.nextRevision();
    this.refs.set(key, { ref, revision });
    return { revision };
  }

  async list(repo: string, ws: string): Promise<string[]> {
    const prefix = this.makePrefix(repo, ws);
    const paths: string[] = [];
    for (const key of this.refs.keys()) {
      if (key.startsWith(prefix)) {
        paths.push(key.slice(prefix.length));
      }
    }
    return paths;
  }

  async remove(repo: string, ws: string, path: string): Promise<void> {
    this.refs.delete(this.makeKey(repo, ws, path));
  }

  async removeAll(repo: string, ws: string): Promise<void> {
    const prefix = this.makePrefix(repo, ws);
    for (const key of [...this.refs.keys()]) {
      if (key.startsWith(prefix)) {
        this.refs.delete(key);
      }
    }
  }

  drop(repo: string): number {
    let dropped = 0;
    for (const key of [...this.refs.keys()]) {
      if (key.startsWith(`${repo}:`)) {
        this.refs.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  clear(): void {
    this.refs.clear();
  }
}

/**
 * In-memory implementation of StorageBackend for testing.
 *
 * All data is stored in memory maps. Useful for unit tests
 * where filesystem access is not needed.
 */
export class InMemoryStorage implements StorageBackend {
  /** The backend's own upgrades: none, unless a test gives some */
  public readonly upgrades: RepositoryUpgrade[];
  public readonly objects: InMemoryObjectStore;
  public readonly refs: InMemoryRefStore;
  public readonly locks: InMemoryLockService;
  public readonly logs: InMemoryLogStore;
  public readonly repos: InMemoryRepoStore;
  public readonly datasets: InMemoryDatasetRefStore;
  /** Every repository's runs' states, in one store */
  private readonly states: InMemoryStateStore;

  /**
   * @param options - `upgrades`: the backend's own upgrades, for a test of
   *   what an open does with a backend's steps
   */
  constructor(options: { upgrades?: RepositoryUpgrade[] } = {}) {
    this.upgrades = options.upgrades ?? [];
    this.objects = new InMemoryObjectStore();
    this.states = new InMemoryStateStore();
    this.refs = new InMemoryRefStore(this.states);
    this.locks = new InMemoryLockService();
    this.logs = new InMemoryLogStore();
    this.datasets = new InMemoryDatasetRefStore();
    this.repos = new InMemoryRepoStore(this.refs, this.datasets, this.objects, this.upgrades, [this.refs, this.datasets, this.logs, this.locks, this.states]);
  }

  /**
   * The store of a repository's dataflow runs' states: one store, which keeps
   * every repository's runs apart by their names.
   *
   * @param _repo - Repository identifier
   * @returns The run state store
   */
  runStates(_repo: string): ExecutionStateStore {
    return this.states;
  }

  async validateRepository(repo: string): Promise<void> {
    if (!(await this.repos.exists(repo))) {
      throw new RepoNotFoundError(repo);
    }
  }

  /**
   * Clear all stored data.
   * Useful for test cleanup.
   */
  clear(): void {
    this.objects.clear();
    this.refs.clear();
    this.locks.clear();
    this.logs.clear();
    this.repos.clear();
    this.datasets.clear();
    this.states.clear();
  }
}
