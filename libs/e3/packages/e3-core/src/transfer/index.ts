/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

// Types
export {
  DatasetUploadType,
  type DatasetUpload,
  DatasetCommitStatusType,
  type DatasetCommitStatus,
  PackageImportType,
  PackageImportProgressType,
  PackageImportStatusType,
  type PackageImport,
  PackageExportType,
  PackageExportProgressType,
  PackageExportStatusType,
  type PackageExport,
  PackageZipCheckpointType,
  type PackageZipCheckpoint,
  WorkspaceDeployJobType,
  type WorkspaceDeployJob,
  RepoGcJobType,
  type RepoGcJob,
  SplitCallJobStatusType,
  SplitCallJobType,
  type SplitCallJob,
} from './types.js';

// Interfaces
export {
  type DatasetPartUpload,
  type DatasetUploadStore,
  type DatasetDownloadStore,
  type PackageImportStore,
  type PackageExportStore,
  type WorkspaceDeployStore,
  type RepoGcStore,
  type SplitCallStore,
  type TransferBackend,
} from './interfaces.js';

// InMemory implementation
export {
  DEFAULT_TRANSFER_PART_BYTES,
  InMemoryTransferBackend,
  type InMemoryTransferBackendOptions,
  type UploadCommitForm,
} from './InMemoryTransferBackend.js';

// Shared processing handlers
export {
  handleProcessExport,
  handleProcessImport,
  type ProcessExportDeps,
  type ProcessExportInput,
  type ProcessImportDeps,
  type ProcessImportInput,
} from './process-files.js';
export {
  handleProcessDeploy,
  handleProcessGc,
  handleProcessSplitCall,
  type ProcessDeployDeps,
  type ProcessDeployInput,
  type ProcessGcDeps,
  type ProcessGcInput,
  type ProcessSplitCallDeps,
  type ProcessSplitCallInput,
} from './process.js';
