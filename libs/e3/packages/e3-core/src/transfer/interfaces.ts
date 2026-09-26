/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Transfer backend interfaces for presigned URL object transfer.
 *
 * TransferBackend is a separate top-level interface (not part of StorageBackend).
 * It provides cloud-agnostic abstractions for uploading/downloading datasets and
 * packages via presigned URLs. Implementations:
 * - InMemoryTransferBackend (local server, tests)
 * - S3DynamoTransferBackend (AWS cloud, future)
 */

import type { DatasetUpload, PackageImport, PackageExport, WorkspaceDeployJob } from './types.js';

// =============================================================================
// Dataset Upload Store
// =============================================================================

/**
 * Where and how a client sends one part of an upload planned as parts.
 */
export interface DatasetPartUpload {
  /** The URL the client PUTs the part's bytes to, with no `Authorization` header. */
  url: string;
  /** Request headers the PUT must carry exactly as given (e.g. a signed checksum). */
  headers: Record<string, string>;
}

/**
 * Manages staged dataset uploads.
 *
 * Flow: create → createParts → getPartUpload per part → (client uploads the
 * parts) → commit → delete
 */
export interface DatasetUploadStore {
  create(id: string, record: DatasetUpload): Promise<void>;
  get(id: string): Promise<DatasetUpload | null>;
  delete(id: string): Promise<void>;

  /**
   * Plan a created upload as parts.
   *
   * @remarks
   * Every part but the last is exactly the returned size, and an upload no
   * larger than it is one part. The plan is the backend's to choose and to
   * remember: a local store takes its configured part size, while an object
   * store may send an upload it can take in one PUT as a single part carrying a
   * checksum header, and a larger one as a multipart upload whose part size
   * keeps the part count within its limits.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @returns The byte size of every part but the last
   */
  createParts(id: string, record: DatasetUpload): Promise<bigint>;

  /**
   * The part size {@link createParts} planned for an upload.
   *
   * @param id - The upload's id
   * @returns The part size, or `null` when the upload was not planned as parts
   */
  getPartBytes(id: string): Promise<bigint | null>;

  /**
   * Where and how the client sends one part of an upload planned as parts.
   *
   * @param id - The upload's id
   * @param record - The upload, as created
   * @param part - The part's number, from 1
   * @returns The part's URL and the headers its PUT must carry
   */
  getPartUpload(id: string, record: DatasetUpload, part: number): Promise<DatasetPartUpload>;

  /**
   * Verify the upload and make the object visible in the catalogue.
   * On success, the object is queryable via storage.objects.read(repo, hash).
   * On failure, throws — caller should clean up the transfer record.
   */
  commitObject(repo: string, hash: string, uploadId: string): Promise<void>;
}

// =============================================================================
// Dataset Download Store
// =============================================================================

/**
 * Generates download URLs for dataset objects.
 *
 * Local: creates temporary records so `/api/downloads/:id` can look up the object.
 * Cloud: returns presigned S3 URLs directly; `get`/`delete` are never called.
 */
export interface DatasetDownloadStore {
  /** Create a temporary download record and return the URL. */
  getDownloadUrl(repo: string, hash: string): Promise<string>;
  /** Look up a download record by ID (for local server data handlers). */
  get(id: string): Promise<{ repo: string; hash: string } | null>;
  /** Clean up after serving. */
  delete(id: string): Promise<void>;
}

// =============================================================================
// Package Import Store
// =============================================================================

/**
 * Manages package import lifecycle: upload zip → process → poll completion.
 *
 * Flow: create → getUploadUrl → (client uploads) → execute → poll get → delete
 */
export interface PackageImportStore {
  create(id: string, record: PackageImport): Promise<void>;
  get(id: string): Promise<PackageImport | null>;
  updateStatus(id: string, status: PackageImport['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /** URL the client PUTs zip bytes to. */
  getUploadUrl(id: string, repo: string): Promise<string>;

  /**
   * Dispatch processing.
   * Local: calls packageImport() inline, updates status to completed/failed.
   * Cloud: invokes background processor asynchronously.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Package Export Store
// =============================================================================

/**
 * Manages package export lifecycle: trigger → process → poll → download.
 *
 * Flow: create → execute → poll get → getDownloadUrl → delete
 */
export interface PackageExportStore {
  create(id: string, record: PackageExport): Promise<void>;
  get(id: string): Promise<PackageExport | null>;
  updateStatus(id: string, status: PackageExport['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /** URL the client GETs zip bytes from. */
  getDownloadUrl(id: string, repo: string): Promise<string>;

  /**
   * Dispatch processing.
   * Local: calls packageExport() inline, updates status to completed/failed.
   * Cloud: invokes background processor asynchronously.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Workspace Deploy Store
// =============================================================================

/**
 * Manages workspace deploy jobs: trigger → process → poll.
 *
 * @remarks
 * A deploy that migrates a record, or builds an index over one, takes as long
 * as the record is large, which outlasts a request. So it runs as a job in the
 * compute the store dispatches it to, and the client polls its status.
 *
 * Flow: create → execute → poll get → delete
 */
export interface WorkspaceDeployStore {
  create(id: string, record: WorkspaceDeployJob): Promise<void>;
  get(id: string): Promise<WorkspaceDeployJob | null>;
  updateStatus(id: string, status: WorkspaceDeployJob['status']): Promise<void>;
  delete(id: string): Promise<void>;

  /**
   * Dispatch processing.
   * Local: runs `handleProcessDeploy` in the background, on the server's runner.
   * Cloud: invokes its own compute, which runs `handleProcessDeploy` on its runner.
   */
  execute(id: string, repo: string): Promise<void>;
}

// =============================================================================
// Transfer Backend
// =============================================================================

/**
 * Cloud-agnostic transfer backend for presigned URL object transfer, and the
 * jobs that outlast a request.
 *
 * Separate from StorageBackend — depends on it for actual object/ref operations
 * but has its own lifecycle (staging, jobs, URLs).
 */
export interface TransferBackend {
  readonly datasetUpload: DatasetUploadStore;
  readonly datasetDownload: DatasetDownloadStore;
  readonly packageImport: PackageImportStore;
  readonly packageExport: PackageExportStore;
  readonly workspaceDeploy: WorkspaceDeployStore;
}
