/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-memory TransferBackend implementation.
 *
 * Stores transfer records in memory Maps. When `storage` and `getRepoPath`
 * are provided, `execute()` performs real background processing via the
 * shared handlers. Without them, falls back to mock behavior for tests.
 */

/* eslint-disable @typescript-eslint/require-await */
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { none, some, variant } from '@elaraai/east';
import { urlPathToTreePath, type FunctionCallCancel, type IntakeFile } from '@elaraai/e3-types';

import type { LockHandle, StorageBackend } from '../storage/index.js';
import type { TaskRunner } from '../execution/interfaces.js';
import { adoptProgressToIntakeFile, datasetAdoptObject, type DatasetAdoptProgress } from '../dataset-adopt.js';
import { datasetAdoptFile } from '../dataset-adopt-file.js';
import { DatasetTypeMismatchError } from '../errors.js';
import { acquireRunningWork } from '../running-work.js';
import { packageStagingPath, transferStagingDir, transferStagingPath } from '../storage/local/localHelpers.js';
import type {
  TransferBackend,
  DatasetPartUpload,
  DatasetUploadStore,
  DatasetDownloadStore,
  FunctionCallDispatch,
  ObjectUploadStore,
  PackageImportStore,
  PackageExportStore,
  RecordLoadStore,
  RepoGcStore,
  SplitCallStore,
  WorkspaceDeployStore,
} from './interfaces.js';
import type {
  DatasetCommitStatus, DatasetUpload, ObjectCommitStatus, ObjectUploadJob, PackageImport, PackageExport, RecordLoadJob, RepoGcJob, SplitCallJob,
  WorkspaceDeployJob,
} from './types.js';
import { handleProcessDeploy, handleProcessGc, handleProcessRecordLoadInOrder, handleProcessSplitCall } from './process.js';
import { JobOrder, loadJobKey } from './job-progress.js';
import { handleProcessExport, handleProcessImport } from './process-files.js';
import { InProcessFunctionCallDispatch } from './in-process-calls.js';

/** The part size a dataset upload is planned with by default. */
export const DEFAULT_TRANSFER_PART_BYTES = 64 * 1024 * 1024;

/** How long a finished commit's status, and its upload, stay readable. */
const COMMIT_RESULT_TTL_MS = 10 * 60 * 1000;

/** How long a finished split call's record stays readable for its poll. */
const SPLIT_CALL_RESULT_TTL_MS = 10 * 60 * 1000;

// =============================================================================
// Dataset Upload
// =============================================================================

/** A commit asked for: how it stands, and its end. */
interface UploadCommit<S> {
  status: S;
  /** Settles as the commit finishes; never rejects. */
  settled: Promise<S>;
}

/**
 * How an upload's commit takes the staged bytes in: as the file they are
 * staged in, or first as the object they hash to, as a store whose uploads
 * land in an object store takes them in.
 */
export type UploadCommitForm = 'file' | 'object';

/**
 * The local server's staged uploads: records in memory, each upload's parts
 * staged in one file in its repository, and its commit, asked for once, which
 * takes the file in and is answered as it finished.
 */
abstract class InMemoryStagedUploads<R extends { readonly repo: string }, S extends { readonly type: string }> {
  private readonly records = new Map<string, R>();
  private readonly partPlans = new Map<string, bigint>();
  private readonly commits = new Map<string, UploadCommit<S>>();

  constructor(
    private readonly baseUrl: string,
    private readonly partBytes: bigint,
    protected readonly getRepoPath?: (repo: string) => string,
  ) {}

  async create(id: string, record: R): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<R | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
    this.partPlans.delete(id);
    this.commits.delete(id);
  }

  async createParts(id: string, record: R): Promise<bigint> {
    // The parts are staged in the repository, so the commit takes the file
    // in by a same-device link or rename rather than a copy.
    if (this.getRepoPath !== undefined) {
      await mkdir(transferStagingDir(this.getRepoPath(record.repo)), { recursive: true });
    }
    this.partPlans.set(id, this.partBytes);
    return this.partBytes;
  }

  async getPartBytes(id: string): Promise<bigint | null> {
    return this.partPlans.get(id) ?? null;
  }

  async getPartUpload(id: string, _record: R, part: number): Promise<DatasetPartUpload> {
    // The server streams a part straight to its offset in the staged file, so
    // it needs no headers beyond the bytes' own length.
    return { url: `${this.baseUrl}/api/uploads/${id}/parts/${part}`, headers: {} };
  }

  async commit(id: string, record: R): Promise<S> {
    let commit = this.commits.get(id);
    if (commit === undefined) {
      const started: UploadCommit<S> = { status: this.processing(), settled: Promise.resolve(this.processing()) };
      this.commits.set(id, started);
      // Until it has finished, a poll reads how far it has got.
      started.settled = this.takeIn(id, record, (status) => {
        if (started.status.type === 'processing') started.status = status;
      }).then((status) => {
        started.status = status;
        // The answer stays readable for a while — a client whose response was
        // lost asks again — and then goes, with the upload.
        setTimeout(() => { void this.delete(id); }, COMMIT_RESULT_TTL_MS).unref();
        return status;
      });
      commit = started;
    }
    return commit.settled;
  }

  async getCommitStatus(id: string): Promise<S | null> {
    return this.commits.get(id)?.status ?? null;
  }

  clear(): void {
    this.records.clear();
    this.partPlans.clear();
    this.commits.clear();
  }

  /** The status of a commit under way, before it has said how far it has got. */
  protected abstract processing(): S;

  /**
   * Takes an upload's staged file in, telling `report` how far it has got as
   * it goes; never rejects.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @param report - Hears the commit's status while it runs
   * @returns How the commit finished
   */
  protected abstract takeIn(id: string, record: R, report: (status: S) => void): Promise<S>;
}

/**
 * The local server's dataset uploads, which the commit takes in by link or
 * rename and points the dataset at.
 */
class InMemoryDatasetUploadStore extends InMemoryStagedUploads<DatasetUpload, DatasetCommitStatus> implements DatasetUploadStore {
  constructor(
    baseUrl: string,
    partBytes: bigint,
    private readonly storage?: StorageBackend,
    getRepoPath?: (repo: string) => string,
    private readonly getRunner?: (repoPath: string) => TaskRunner,
    private readonly commitAs: UploadCommitForm = 'file',
  ) {
    super(baseUrl, partBytes, getRepoPath);
  }

  protected processing(): DatasetCommitStatus {
    return variant('processing', none);
  }

  protected takeIn(id: string, record: DatasetUpload, report: (status: DatasetCommitStatus) => void): Promise<DatasetCommitStatus> {
    return this.verifyAndAdopt(id, record, (progress) => report(variant('processing', some(progress))));
  }

  /**
   * Verifies the staged file and points the upload's dataset at it; never
   * rejects. The file is never held whole: its size comes from `stat`, its
   * digest from a streamed hash and its declared type from a read of its head.
   * A collection is then taken in by intake units on the repository's runner,
   * and any other value becomes an object by link or rename. How far it has
   * got goes to `onProgress` as it goes.
   *
   * Committed as an object, the staged bytes first become the object they hash
   * to, refused when that is not the upload's hash, and the object is then
   * adopted (`datasetAdoptObject`), its intake reporting as it goes: how a
   * store whose uploads land in an object store commits one.
   */
  private async verifyAndAdopt(id: string, record: DatasetUpload, onProgress: (progress: IntakeFile) => void): Promise<DatasetCommitStatus> {
    if (this.storage === undefined || this.getRepoPath === undefined) {
      return variant('failed', { message: 'this store takes in no upload: it was given no storage' });
    }
    let stagingPath: string | null = null;
    try {
      const repoPath = this.getRepoPath(record.repo);
      stagingPath = transferStagingPath(repoPath, id);
      const stats = await stat(stagingPath);
      if (BigInt(stats.size) !== record.size) {
        return variant('failed', { message: `size mismatch: expected ${record.size}, got ${stats.size}` });
      }
      const treePath = urlPathToTreePath(record.path);
      const runner = this.getRunner?.(repoPath);
      const report = (progress: DatasetAdoptProgress): void => onProgress(adoptProgressToIntakeFile(record.path, progress));
      if (this.commitAs === 'object') {
        await this.storage.objects.adoptFile(repoPath, stagingPath, record.hash);
        await datasetAdoptObject(this.storage, repoPath, record.workspace, treePath, record.hash, runner, { onProgress: report });
      } else {
        // The staged file is this store's own, and unlinked once the commit
        // ends: the store may take it itself, by a link
        await datasetAdoptFile(this.storage, repoPath, record.workspace, treePath, stagingPath, {
          expectHash: record.hash,
          runner,
          onProgress: report,
          link: true,
        });
      }
      return variant('completed', null);
    } catch (err) {
      if (err instanceof DatasetTypeMismatchError) {
        return variant('type_mismatch', { path: err.path, message: err.message });
      }
      return variant('failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (stagingPath !== null) await unlink(stagingPath).catch(() => {});
    }
  }
}

// =============================================================================
// Object Upload
// =============================================================================

/**
 * The local server's object uploads: staged as a dataset upload's parts are,
 * and committed as the object the bytes hash to, which no ref names.
 */
class InMemoryObjectUploadStore extends InMemoryStagedUploads<ObjectUploadJob, ObjectCommitStatus> implements ObjectUploadStore {
  constructor(
    baseUrl: string,
    partBytes: bigint,
    private readonly storage?: StorageBackend,
    getRepoPath?: (repo: string) => string,
  ) {
    super(baseUrl, partBytes, getRepoPath);
  }

  protected processing(): ObjectCommitStatus {
    return variant('processing', null);
  }

  /**
   * Checks the staged file's size, and stores it as the object it hashes to —
   * by link or rename, never read whole — refused when that is not the
   * upload's hash; never rejects.
   */
  protected async takeIn(id: string, record: ObjectUploadJob): Promise<ObjectCommitStatus> {
    if (this.storage === undefined || this.getRepoPath === undefined) {
      return variant('failed', { message: 'this store takes in no upload: it was given no storage' });
    }
    let stagingPath: string | null = null;
    try {
      const repoPath = this.getRepoPath(record.repo);
      stagingPath = transferStagingPath(repoPath, id);
      const stats = await stat(stagingPath);
      if (BigInt(stats.size) !== record.size) {
        return variant('failed', { message: `size mismatch: expected ${record.size}, got ${stats.size}` });
      }
      await this.storage.objects.adoptFile(repoPath, stagingPath, record.hash);
      return variant('completed', null);
    } catch (err) {
      return variant('failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (stagingPath !== null) await unlink(stagingPath).catch(() => {});
    }
  }
}

// =============================================================================
// Dataset Download
// =============================================================================

class InMemoryDatasetDownloadStore implements DatasetDownloadStore {
  private readonly records = new Map<string, { repo: string; hash: string }>();

  constructor(private readonly baseUrl: string) {}

  async getDownloadUrl(repo: string, hash: string): Promise<string> {
    const id = randomUUID();
    this.records.set(id, { repo, hash });
    return `${this.baseUrl}/api/downloads/${id}`;
  }

  async get(id: string): Promise<{ repo: string; hash: string } | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Package Import
// =============================================================================

class InMemoryPackageImportStore implements PackageImportStore {
  private readonly records = new Map<string, PackageImport>();
  private readonly executing = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
  ) {}

  async create(id: string, record: PackageImport): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<PackageImport | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: PackageImport['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package import ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getUploadUrl(id: string, _repo: string): Promise<string> {
    return `${this.baseUrl}/api/uploads/${id}`;
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package import ${id} not found`);

    if (this.executing.has(id)) return;
    this.executing.add(id);

    if (!this.storage || !this.getRepoPath) {
      // Mock fallback for tests that don't provide storage
      await this.updateStatus(id, variant('completed', {
        name: 'mock',
        version: '0.0.0',
        packageHash: 'mock',
        objectCount: 0n,
      }));
      this.executing.delete(id);
      return;
    }

    // The zip the upload staged, in the repository.
    const repoPath = this.getRepoPath(repo);
    const zipPath = packageStagingPath(repoPath, id);
    await mkdir(transferStagingDir(repoPath), { recursive: true });
    void handleProcessImport(
      { storage: this.storage, importStore: this },
      { id, repo: repoPath, zip: zipPath },
    ).catch(() => {
      // Error already recorded in job status by handleProcessImport
    }).finally(() => {
      this.executing.delete(id);
    });
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Package Export
// =============================================================================

class InMemoryPackageExportStore implements PackageExportStore {
  private readonly records = new Map<string, PackageExport>();
  private readonly executing = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
  ) {}

  async create(id: string, record: PackageExport): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<PackageExport | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: PackageExport['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package export ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getDownloadUrl(id: string, _repo: string): Promise<string> {
    return `${this.baseUrl}/api/downloads/${id}`;
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Package export ${id} not found`);

    if (this.executing.has(id)) return;
    this.executing.add(id);

    if (!this.storage || !this.getRepoPath) {
      // Mock fallback for tests that don't provide storage
      await this.updateStatus(id, variant('completed', { size: 0n }));
      this.executing.delete(id);
      return;
    }

    // Staged in the repository until the download takes it, or gc sweeps it.
    const repoPath = this.getRepoPath(repo);
    const zipPath = packageStagingPath(repoPath, id);
    await mkdir(transferStagingDir(repoPath), { recursive: true });
    void handleProcessExport(
      { storage: this.storage, exportStore: this },
      { id, repo: repoPath, zip: zipPath },
    ).catch(() => {
      // Error already recorded in job status by handleProcessExport
    }).finally(() => {
      this.executing.delete(id);
    });
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Workspace Deploy
// =============================================================================

class InMemoryWorkspaceDeployStore implements WorkspaceDeployStore {
  private readonly records = new Map<string, WorkspaceDeployJob>();
  private readonly executing = new Set<string>();

  constructor(
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
    private readonly getRunner?: (repoPath: string) => TaskRunner,
  ) {}

  async create(id: string, record: WorkspaceDeployJob): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<WorkspaceDeployJob | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: WorkspaceDeployJob['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Workspace deploy ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Workspace deploy ${id} not found`);

    if (this.executing.has(id)) return;
    this.executing.add(id);

    if (!this.storage || !this.getRepoPath) {
      // Mock fallback for tests that don't provide storage
      await this.updateStatus(id, variant('completed', { records: [], indexes: [], inputs: [], warnings: [] }));
      this.executing.delete(id);
      return;
    }

    // The deploy runs in this process, on the runner every record operation
    // of the server runs on, and outlives the request that started it.
    const repoPath = this.getRepoPath(repo);
    const runner = this.getRunner?.(repoPath);
    void handleProcessDeploy(
      { storage: this.storage, deployStore: this, ...(runner !== undefined && { runner }) },
      { id, repo: repoPath },
    ).catch(() => {
      // Error already recorded in job status by handleProcessDeploy
    }).finally(() => {
      this.executing.delete(id);
    });
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Repository GC
// =============================================================================

class InMemoryRepoGcStore implements RepoGcStore {
  private readonly records = new Map<string, RepoGcJob>();
  private readonly executing = new Set<string>();

  constructor(
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
    private readonly getRunner?: (repoPath: string) => TaskRunner,
  ) {}

  async create(id: string, record: RepoGcJob): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<RepoGcJob | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: RepoGcJob['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`gc job ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`gc job ${id} not found`);

    if (this.executing.has(id)) return;
    this.executing.add(id);

    if (!this.storage || !this.getRepoPath) {
      // Mock fallback for tests that don't provide storage
      await this.updateStatus(id, {
        status: variant('succeeded', null),
        stats: some({
          deletedObjects: 0n, deletedPartials: 0n, retainedObjects: 0n, skippedYoung: 0n, bytesFreed: 0n,
          deletedRuns: 0n, deletedExecutions: 0n,
        }),
        error: none,
      });
      this.executing.delete(id);
      return;
    }

    // gc runs in this process, and outlives the request that started it. Its
    // history prune takes the runner's judgement of what still runs.
    const repoPath = this.getRepoPath(repo);
    const runner = this.getRunner?.(repoPath);
    void handleProcessGc(
      { storage: this.storage, gcStore: this, ...(runner !== undefined && { runner }) },
      { id, repo: repoPath },
    ).catch(() => {
      // Error already recorded in job status by handleProcessGc
    }).finally(() => {
      this.executing.delete(id);
    });
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Split Call
// =============================================================================

/**
 * The local server's jobs of one kind whose end is written once: records in
 * memory, each job run in this process on the repository's runner, a status
 * taken only while the job has not ended, and a record forgotten a while
 * after its job ends. What a split call's store and a record load's share.
 *
 * @typeParam J - A job's record, whose status is `processing` until it ends
 */
abstract class InMemoryEndedJobs<J extends { readonly status: { readonly type: string } }> {
  protected readonly records = new Map<string, J>();
  private readonly executing = new Set<string>();

  /**
   * @param what - The kind of job, as an error names one: `Split call`
   * @param ttlMs - How long an ended job's record stays readable for its poll
   * @param storage - The storage the jobs run over, when the backend runs any
   * @param getRepoPath - The repository a job names, as a path
   * @param getRunner - The runner a repository's jobs run on
   */
  constructor(
    private readonly what: string,
    private readonly ttlMs: number,
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
    private readonly getRunner?: (repoPath: string) => TaskRunner,
  ) {}

  /** The status of a job that ended failed, for the reason given. */
  protected abstract failure(message: string): J['status'];

  async create(id: string, record: J): Promise<void> {
    this.records.set(id, record);
    // A job filed already ended — a launch that found the request wrong — is
    // forgotten as one that ran is.
    if (record.status.type !== 'processing') this.forget(id);
  }

  async get(id: string): Promise<J | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: J['status']): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) throw new Error(`${this.what} ${id} not found`);
    // Checked and written with nothing awaited between: one step.
    if (record.status.type !== 'processing') return false;
    this.records.set(id, { ...record, status });
    return true;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }

  /**
   * Takes a job to run: its record, and what it runs on. A job that has ended,
   * or is running, is not taken twice; and a backend given no storage or
   * runner ends it failed, saying so.
   *
   * @returns The job, which its caller {@link settled | settles} once its run
   *   has ended; `null` when there is nothing to run
   */
  protected async taken(id: string, repo: string, runsNone: string): Promise<{ record: J; storage: StorageBackend; repoPath: string; runner: TaskRunner } | null> {
    const record = this.records.get(id);
    if (!record) throw new Error(`${this.what} ${id} not found`);
    if (record.status.type !== 'processing' || this.executing.has(id)) return null;
    this.executing.add(id);

    const repoPath = this.storage !== undefined && this.getRepoPath !== undefined ? this.getRepoPath(repo) : undefined;
    const runner = repoPath === undefined ? undefined : this.getRunner?.(repoPath);
    if (this.storage === undefined || repoPath === undefined || runner === undefined) {
      await this.failed(id, runsNone);
      return null;
    }
    return { record, storage: this.storage, repoPath, runner };
  }

  /** Ends a job taken that could not start: failed, for the reason given. */
  protected async failed(id: string, message: string): Promise<void> {
    await this.updateStatus(id, this.failure(message));
    this.settled(id);
  }

  /** A job taken has ended its run: it may be taken no more, and its record
   *  is forgotten once its poll has had a while to read it. */
  protected settled(id: string): void {
    this.executing.delete(id);
    this.forget(id);
  }

  private forget(id: string): void {
    setTimeout(() => { this.records.delete(id); }, this.ttlMs).unref();
  }
}

/**
 * The local server's split calls: records in memory, each job run in this
 * process on the repository's runner, and its record forgotten a while after
 * it finishes.
 */
class InMemorySplitCallStore extends InMemoryEndedJobs<SplitCallJob> implements SplitCallStore {
  constructor(
    storage?: StorageBackend,
    getRepoPath?: (repo: string) => string,
    getRunner?: (repoPath: string) => TaskRunner,
    private readonly width?: number,
  ) {
    super('Split call', SPLIT_CALL_RESULT_TTL_MS, storage, getRepoPath, getRunner);
  }

  protected failure(message: string): SplitCallJob['status'] {
    return variant('failed', { message });
  }

  async execute(id: string, repo: string): Promise<void> {
    const job = await this.taken(id, repo, 'this backend runs no split call: it was given no storage or runner');
    if (job === null) return;

    // The job runs in this process, on the runner every task of the server
    // runs on, and outlives the request that launched it.
    void handleProcessSplitCall(
      { storage: job.storage, splitCallStore: this, runner: job.runner, ...(this.width !== undefined && { width: this.width }) },
      { id, repo: job.repoPath },
    ).catch(() => {
      // Error already recorded in job status by handleProcessSplitCall
    }).finally(() => {
      this.settled(id);
    });
  }
}

// =============================================================================
// Record Load
// =============================================================================

/** How long a finished load's record stays readable for its poll. */
const RECORD_LOAD_RESULT_TTL_MS = 10 * 60 * 1000;

/**
 * The local server's load jobs: records in memory, each job run in this
 * process on the repository's runner, each source's jobs going on in the
 * order they were filed (ruling 37, `handleProcessRecordLoadInOrder`), and a
 * record forgotten a while after its job ends.
 */
class InMemoryRecordLoadStore extends InMemoryEndedJobs<RecordLoadJob> implements RecordLoadStore {
  /** The order each source's jobs go on in */
  private readonly order = new JobOrder();

  constructor(
    storage?: StorageBackend,
    getRepoPath?: (repo: string) => string,
    getRunner?: (repoPath: string) => TaskRunner,
  ) {
    super('Record load', RECORD_LOAD_RESULT_TTL_MS, storage, getRepoPath, getRunner);
  }

  protected failure(message: string): RecordLoadJob['status'] {
    return variant('failed', { message });
  }

  async cancel(id: string, cancel: FunctionCallCancel): Promise<RecordLoadJob | null> {
    const record = this.records.get(id);
    if (!record) return null;
    // Checked and written with nothing awaited between: one step.
    if (record.status.type !== 'processing' || record.cancel.type === 'some') return record;
    const asked: RecordLoadJob = { ...record, cancel: some(cancel) };
    this.records.set(id, asked);
    return asked;
  }

  async execute(id: string, repo: string): Promise<void> {
    // Its place among its source's loads is taken before anything is awaited:
    // the order the jobs are asked to run in is the order they were filed
    const filed = this.records.get(id);
    const place = filed === undefined ? null : this.order.take(loadJobKey(filed));
    let runs = false;
    try {
      const job = await this.taken(id, repo, 'this backend runs no load: it was given no storage or runner');
      if (job === null || place === null) return;
      const { storage, repoPath, runner } = job;
      // Held from now until the job ends, so no sweep takes its delivery while
      // it waits for an earlier load of its source
      let work: LockHandle;
      try {
        work = await acquireRunningWork(storage, repoPath);
      } catch (err) {
        await this.failed(id, err instanceof Error ? err.message : String(err));
        return;
      }
      runs = true;
      // The job runs in this process, on the runner every task of the server
      // runs on, and outlives the request that launched it. It leaves its place
      // however it ends.
      void handleProcessRecordLoadInOrder({ storage, recordLoadStore: this, runner }, { id, repo: repoPath }, place)
        .catch(() => {
          // Its end is recorded in the job's status by handleProcessRecordLoad
        })
        .finally(() => {
          this.settled(id);
          // A release that fails is the lock service's to clean up: nothing is left waiting on it
          return work.release().catch(() => undefined);
        });
    } finally {
      // A job that did not start leaves its place
      if (!runs) place?.leave();
    }
  }
}

// =============================================================================
// Function Calls
// =============================================================================

/**
 * The function calls of a backend given no storage or runner: it runs none, so
 * a call dispatched to it is recorded lost, saying why.
 */
const NO_FUNCTION_CALLS: FunctionCallDispatch = {
  execute: async () => {
    throw new Error('this backend runs no function call: it was given no storage or runner');
  },
  wait: async () => null,
  cancel: async () => {},
};

// =============================================================================
// Transfer Backend
// =============================================================================

export interface InMemoryTransferBackendOptions {
  baseUrl?: string;
  storage?: StorageBackend;
  getRepoPath?: (repo: string) => string;
  /**
   * The runner, for a repository's path, that a deploy job runs its
   * migrations and index builds on, an upload's commit its intake units, a
   * split call its units and a load its intake and its pieces, and whose
   * judgement of what still runs gc's history prune takes. Without one, a
   * deploy that owes either is refused before it writes anything, a commit of
   * a collection the store does not know fails, a split call and a load fail,
   * and gc keeps every execution recorded running.
   */
  getRunner?: (repoPath: string) => TaskRunner;
  /**
   * The part size dataset uploads are planned with (default
   * {@link DEFAULT_TRANSFER_PART_BYTES}). An upload no larger is one part.
   */
  partBytes?: number;
  /**
   * How an upload's commit takes the staged bytes in (default `file`): `object`
   * commits as a store whose uploads land in an object store does, adopting the
   * object the bytes hash to — what a test of that path runs.
   */
  commitAs?: UploadCommitForm;
  /**
   * How many units a `first` split call's job keeps running at once (#1110),
   * 4 by default: a server passes its budget's cores.
   */
  splitCallWidth?: number;
  /**
   * How often a running function call reads its record for a request to
   * cancel it, in ms (default a second). A request made through this backend's
   * dispatch stops the call at once whatever this is.
   */
  functionCallWatchMs?: number;
}

export class InMemoryTransferBackend implements TransferBackend {
  readonly datasetUpload: InMemoryDatasetUploadStore;
  readonly datasetDownload: InMemoryDatasetDownloadStore;
  readonly packageImport: InMemoryPackageImportStore;
  readonly packageExport: InMemoryPackageExportStore;
  readonly workspaceDeploy: InMemoryWorkspaceDeployStore;
  readonly repoGc: InMemoryRepoGcStore;
  readonly splitCall: InMemorySplitCallStore;
  readonly recordLoad: InMemoryRecordLoadStore;
  readonly objectUpload: InMemoryObjectUploadStore;
  readonly functionCalls: FunctionCallDispatch;

  constructor(options: InMemoryTransferBackendOptions) {
    const baseUrl = options.baseUrl ?? '';
    const partBytes = options.partBytes ?? DEFAULT_TRANSFER_PART_BYTES;
    if (!Number.isSafeInteger(partBytes) || partBytes < 1) {
      throw new Error(`partBytes must be a positive integer, got ${partBytes}`);
    }
    this.datasetUpload = new InMemoryDatasetUploadStore(baseUrl, BigInt(partBytes), options.storage, options.getRepoPath, options.getRunner, options.commitAs);
    this.datasetDownload = new InMemoryDatasetDownloadStore(baseUrl);
    this.packageImport = new InMemoryPackageImportStore(baseUrl, options.storage, options.getRepoPath);
    this.packageExport = new InMemoryPackageExportStore(baseUrl, options.storage, options.getRepoPath);
    this.workspaceDeploy = new InMemoryWorkspaceDeployStore(options.storage, options.getRepoPath, options.getRunner);
    this.repoGc = new InMemoryRepoGcStore(options.storage, options.getRepoPath, options.getRunner);
    this.splitCall = new InMemorySplitCallStore(options.storage, options.getRepoPath, options.getRunner, options.splitCallWidth);
    this.recordLoad = new InMemoryRecordLoadStore(options.storage, options.getRepoPath, options.getRunner);
    this.objectUpload = new InMemoryObjectUploadStore(baseUrl, BigInt(partBytes), options.storage, options.getRepoPath);
    // A call runs in this process, on the runner every task of the server runs
    // on, and outlives the request that filed it
    const { storage, getRepoPath, getRunner, functionCallWatchMs } = options;
    this.functionCalls = storage === undefined || getRepoPath === undefined || getRunner === undefined
      ? NO_FUNCTION_CALLS
      : new InProcessFunctionCallDispatch({ storage, getRepoPath, getRunner, ...(functionCallWatchMs !== undefined && { watchMs: functionCallWatchMs }) });
  }

  clear(): void {
    this.datasetUpload.clear();
    this.datasetDownload.clear();
    this.packageImport.clear();
    this.packageExport.clear();
    this.workspaceDeploy.clear();
    this.repoGc.clear();
    this.splitCall.clear();
    this.recordLoad.clear();
    this.objectUpload.clear();
  }
}
