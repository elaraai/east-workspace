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
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { variant } from '@elaraai/east';

import type { StorageBackend } from '../storage/index.js';
import type {
  TransferBackend,
  DatasetPartUpload,
  DatasetUploadStore,
  DatasetDownloadStore,
  PackageImportStore,
  PackageExportStore,
} from './interfaces.js';
import type { DatasetUpload, PackageImport, PackageExport } from './types.js';
import { handleProcessExport, handleProcessImport } from './process.js';

const STAGING_DIR = join(tmpdir(), 'e3-transfers');

/** The part size a protocol-2 dataset upload is planned with by default. */
export const DEFAULT_TRANSFER_PART_BYTES = 64 * 1024 * 1024;

// =============================================================================
// Dataset Upload
// =============================================================================

class InMemoryDatasetUploadStore implements DatasetUploadStore {
  private readonly records = new Map<string, DatasetUpload>();
  private readonly partPlans = new Map<string, bigint>();

  constructor(private readonly baseUrl: string, private readonly partBytes: bigint) {}

  async create(id: string, record: DatasetUpload): Promise<void> {
    this.records.set(id, record);
  }

  async get(id: string): Promise<DatasetUpload | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
    this.partPlans.delete(id);
  }

  async getUploadUrl(id: string, _repo: string, _hash: string): Promise<string> {
    return `${this.baseUrl}/api/uploads/${id}`;
  }

  async createParts(id: string, _record: DatasetUpload): Promise<bigint> {
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

  async commitObject(_repo: string, _hash: string, uploadId: string): Promise<void> {
    // Mock — just remove the record. Real verification happens in integration tests.
    this.records.delete(uploadId);
    this.partPlans.delete(uploadId);
  }

  clear(): void {
    this.records.clear();
    this.partPlans.clear();
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

    const zipPath = join(STAGING_DIR, `${id}.zip.partial`);
    await mkdir(STAGING_DIR, { recursive: true });
    void handleProcessImport(
      { storage: this.storage, importStore: this },
      { id, repo: this.getRepoPath(repo), zipPath },
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

    const zipPath = join(STAGING_DIR, `${id}.zip`);
    await mkdir(STAGING_DIR, { recursive: true });
    void handleProcessExport(
      { storage: this.storage, exportStore: this },
      { id, repo: this.getRepoPath(repo), zipPath },
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
// Transfer Backend
// =============================================================================

export interface InMemoryTransferBackendOptions {
  baseUrl?: string;
  storage?: StorageBackend;
  getRepoPath?: (repo: string) => string;
  /**
   * The part size protocol-2 dataset uploads are planned with (default
   * {@link DEFAULT_TRANSFER_PART_BYTES}). An upload no larger is one part.
   */
  partBytes?: number;
}

export class InMemoryTransferBackend implements TransferBackend {
  readonly datasetUpload: InMemoryDatasetUploadStore;
  readonly datasetDownload: InMemoryDatasetDownloadStore;
  readonly packageImport: InMemoryPackageImportStore;
  readonly packageExport: InMemoryPackageExportStore;

  constructor(options: InMemoryTransferBackendOptions) {
    const baseUrl = options.baseUrl ?? '';
    const partBytes = options.partBytes ?? DEFAULT_TRANSFER_PART_BYTES;
    if (!Number.isSafeInteger(partBytes) || partBytes < 1) {
      throw new Error(`partBytes must be a positive integer, got ${partBytes}`);
    }
    this.datasetUpload = new InMemoryDatasetUploadStore(baseUrl, BigInt(partBytes));
    this.datasetDownload = new InMemoryDatasetDownloadStore(baseUrl);
    this.packageImport = new InMemoryPackageImportStore(baseUrl, options.storage, options.getRepoPath);
    this.packageExport = new InMemoryPackageExportStore(baseUrl, options.storage, options.getRepoPath);
  }

  clear(): void {
    this.datasetUpload.clear();
    this.datasetDownload.clear();
    this.packageImport.clear();
    this.packageExport.clear();
  }
}
