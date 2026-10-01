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
import { urlPathToTreePath, type IntakeFile } from '@elaraai/e3-types';

import type { StorageBackend } from '../storage/index.js';
import type { TaskRunner } from '../execution/interfaces.js';
import { adoptProgressToIntakeFile, datasetAdoptObject, type DatasetAdoptProgress } from '../dataset-adopt.js';
import { datasetAdoptFile } from '../dataset-adopt-file.js';
import { DatasetTypeMismatchError } from '../errors.js';
import { packageStagingPath, transferStagingDir, transferStagingPath } from '../storage/local/localHelpers.js';
import type {
  TransferBackend,
  DatasetPartUpload,
  DatasetUploadStore,
  DatasetDownloadStore,
  PackageImportStore,
  PackageExportStore,
  RepoGcStore,
  SplitCallStore,
  WorkspaceDeployStore,
} from './interfaces.js';
import type { DatasetCommitStatus, DatasetUpload, PackageImport, PackageExport, RepoGcJob, SplitCallJob, WorkspaceDeployJob } from './types.js';
import { handleProcessDeploy, handleProcessGc, handleProcessSplitCall } from './process.js';
import { handleProcessExport, handleProcessImport } from './process-files.js';

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
interface UploadCommit {
  status: DatasetCommitStatus;
  /** Settles as the commit finishes; never rejects. */
  settled: Promise<DatasetCommitStatus>;
}

/**
 * How an upload's commit takes the staged bytes in: as the file they are
 * staged in, or first as the object they hash to, as a store whose uploads
 * land in an object store takes them in.
 */
export type UploadCommitForm = 'file' | 'object';

/**
 * The local server's uploads: records in memory, each upload's parts staged
 * in one file in its repository, which the commit takes in by link or rename.
 */
class InMemoryDatasetUploadStore implements DatasetUploadStore {
  private readonly records = new Map<string, DatasetUpload>();
  private readonly partPlans = new Map<string, bigint>();
  private readonly commits = new Map<string, UploadCommit>();

  constructor(
    private readonly baseUrl: string,
    private readonly partBytes: bigint,
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
    private readonly getRunner?: (repoPath: string) => TaskRunner,
    private readonly commitAs: UploadCommitForm = 'file',
  ) {}

  async create(id: string, record: DatasetUpload): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<DatasetUpload | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
    this.partPlans.delete(id);
    this.commits.delete(id);
  }

  async createParts(id: string, record: DatasetUpload): Promise<bigint> {
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

  async getPartUpload(id: string, _record: DatasetUpload, part: number): Promise<DatasetPartUpload> {
    // The server streams a part straight to its offset in the staged file, so
    // it needs no headers beyond the bytes' own length.
    return { url: `${this.baseUrl}/api/uploads/${id}/parts/${part}`, headers: {} };
  }

  async commit(id: string, record: DatasetUpload): Promise<DatasetCommitStatus> {
    let commit = this.commits.get(id);
    if (commit === undefined) {
      const started: UploadCommit = { status: variant('processing', none), settled: Promise.resolve(variant('processing', none)) };
      this.commits.set(id, started);
      // Until it has finished, a poll reads how far it has got.
      started.settled = this.verifyAndAdopt(id, record, (progress) => {
        if (started.status.type === 'processing') started.status = variant('processing', some(progress));
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

  async getCommitStatus(id: string): Promise<DatasetCommitStatus | null> {
    return this.commits.get(id)?.status ?? null;
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
        await datasetAdoptFile(this.storage, repoPath, record.workspace, treePath, stagingPath, {
          expectHash: record.hash,
          runner,
          onProgress: report,
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

  clear(): void {
    this.records.clear();
    this.partPlans.clear();
    this.commits.clear();
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
      await this.updateStatus(id, variant('completed', { records: [], indexes: [], warnings: [] }));
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

    // gc runs in this process, and outlives the request that started it.
    void handleProcessGc(
      { storage: this.storage, gcStore: this },
      { id, repo: this.getRepoPath(repo) },
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
 * The local server's split calls: records in memory, each job run in this
 * process on the repository's runner, and its record forgotten a while after
 * it finishes.
 */
class InMemorySplitCallStore implements SplitCallStore {
  private readonly records = new Map<string, SplitCallJob>();
  private readonly executing = new Set<string>();

  constructor(
    private readonly storage?: StorageBackend,
    private readonly getRepoPath?: (repo: string) => string,
    private readonly getRunner?: (repoPath: string) => TaskRunner,
  ) {}

  async create(id: string, record: SplitCallJob): Promise<void> {
    this.records.set(id, record);
    // A job filed already finished — a launch that found the request wrong —
    // is forgotten as one that ran is.
    if (record.status.type !== 'processing') this.forget(id);
  }

  async get(id: string): Promise<SplitCallJob | null> {
    return this.records.get(id) ?? null;
  }

  async updateStatus(id: string, status: SplitCallJob['status']): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Split call ${id} not found`);
    this.records.set(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async execute(id: string, repo: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Split call ${id} not found`);
    if (record.status.type !== 'processing' || this.executing.has(id)) return;
    this.executing.add(id);

    const repoPath = this.storage !== undefined && this.getRepoPath !== undefined ? this.getRepoPath(repo) : undefined;
    const runner = repoPath === undefined ? undefined : this.getRunner?.(repoPath);
    if (this.storage === undefined || repoPath === undefined || runner === undefined) {
      await this.updateStatus(id, variant('failed', { message: 'this backend runs no split call: it was given no storage or runner' }));
      this.executing.delete(id);
      this.forget(id);
      return;
    }

    // The job runs in this process, on the runner every task of the server
    // runs on, and outlives the request that launched it.
    void handleProcessSplitCall(
      { storage: this.storage, splitCallStore: this, runner },
      { id, repo: repoPath },
    ).catch(() => {
      // Error already recorded in job status by handleProcessSplitCall
    }).finally(() => {
      this.executing.delete(id);
      this.forget(id);
    });
  }

  /** Forgets a finished job once its poll has had a while to read it. */
  private forget(id: string): void {
    setTimeout(() => { this.records.delete(id); }, SPLIT_CALL_RESULT_TTL_MS).unref();
  }

  clear(): void {
    this.records.clear();
  }
}

// =============================================================================
// Transfer Backend
// =============================================================================

export interface InMemoryTransferBackendOptions {
  baseUrl?: string;
  storage?: StorageBackend;
  getRepoPath?: (repo: string) => string;
  /**
   * The runner, for a repository's path, that a deploy job runs its
   * migrations and index builds on, an upload's commit its intake units, and a
   * split call its units. Without one, a deploy that owes either is refused
   * before it writes anything, a commit of a collection the store does not
   * know fails, and a split call fails.
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
}

export class InMemoryTransferBackend implements TransferBackend {
  readonly datasetUpload: InMemoryDatasetUploadStore;
  readonly datasetDownload: InMemoryDatasetDownloadStore;
  readonly packageImport: InMemoryPackageImportStore;
  readonly packageExport: InMemoryPackageExportStore;
  readonly workspaceDeploy: InMemoryWorkspaceDeployStore;
  readonly repoGc: InMemoryRepoGcStore;
  readonly splitCall: InMemorySplitCallStore;

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
    this.repoGc = new InMemoryRepoGcStore(options.storage, options.getRepoPath);
    this.splitCall = new InMemorySplitCallStore(options.storage, options.getRepoPath, options.getRunner);
  }

  clear(): void {
    this.datasetUpload.clear();
    this.datasetDownload.clear();
    this.packageImport.clear();
    this.packageExport.clear();
    this.workspaceDeploy.clear();
    this.repoGc.clear();
    this.splitCall.clear();
  }
}
