/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * East types for transfer backend stored state.
 *
 * These define the shape of records persisted by TransferBackend implementations
 * (in-memory Maps for local, DynamoDB for cloud).
 */

import {
  StructType,
  StringType,
  IntegerType,
  BooleanType,
  VariantType,
  NullType,
  OptionType,
  DateTimeType,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  GcRequestType, GcStatusResultType, PackageImportProgressType, PackageExportProgressType, SchemaPolicyType, WorkspaceDeployStatusType,
} from '@elaraai/e3-types';
export { PackageImportProgressType, PackageExportProgressType };

// =============================================================================
// Dataset Upload
// =============================================================================

export const DatasetUploadType = StructType({
  repo: StringType,
  workspace: StringType,
  path: StringType,
  hash: StringType,
  size: IntegerType,
});

export type DatasetUpload = ValueTypeOf<typeof DatasetUploadType>;

/**
 * How a dataset upload's commit stands, as a store keeps it for a poll:
 * `processing` while the staged bytes are verified and taken in; `completed`
 * once the dataset names them; `failed`, naming why, when they are not the
 * upload's bytes or cannot be taken in; and `type_mismatch` when they are not
 * of the type the dataset declares, which the API answers as its
 * `dataset_type_mismatch` error.
 */
export const DatasetCommitStatusType = VariantType({
  processing: NullType,
  completed: NullType,
  failed: StructType({ message: StringType }),
  type_mismatch: StructType({ path: StringType, message: StringType }),
});

export type DatasetCommitStatus = ValueTypeOf<typeof DatasetCommitStatusType>;

// =============================================================================
// Package Import
// =============================================================================

export const PackageImportStatusType = VariantType({
  created: NullType,
  uploaded: NullType,
  processing: PackageImportProgressType,
  completed: StructType({
    name: StringType,
    version: StringType,
    packageHash: StringType,
    objectCount: IntegerType,
  }),
  failed: StructType({ message: StringType }),
});

export const PackageImportType = StructType({
  repo: StringType,
  size: IntegerType,
  status: PackageImportStatusType,
  createdAt: DateTimeType,
});

export type PackageImport = ValueTypeOf<typeof PackageImportType>;

// =============================================================================
// Package Export
// =============================================================================

export const PackageExportStatusType = VariantType({
  processing: PackageExportProgressType,
  completed: StructType({ size: IntegerType }),
  failed: StructType({ message: StringType }),
});

export const PackageExportType = StructType({
  repo: StringType,
  name: StringType,
  version: StringType,
  workspace: OptionType(StringType),
  status: PackageExportStatusType,
  createdAt: DateTimeType,
});

export type PackageExport = ValueTypeOf<typeof PackageExportType>;

// =============================================================================
// Workspace Deploy
// =============================================================================

/**
 * A deploy job, as a store keeps it.
 *
 * @remarks
 * The package is resolved when the job is created, so the job deploys the
 * version the request was checked against, even when a later one is imported
 * while it waits.
 */
export const WorkspaceDeployJobType = StructType({
  repo: StringType,
  workspace: StringType,
  packageName: StringType,
  packageVersion: StringType,
  schema: SchemaPolicyType,
  allowDropRecords: BooleanType,
  plan: BooleanType,
  status: WorkspaceDeployStatusType,
  createdAt: DateTimeType,
});

export type WorkspaceDeployJob = ValueTypeOf<typeof WorkspaceDeployJobType>;

// =============================================================================
// Repository GC
// =============================================================================

/**
 * A gc job, as a store keeps it: the repository, what gc was asked to keep
 * and whether to delete, and the status a poll reads.
 */
export const RepoGcJobType = StructType({
  repo: StringType,
  request: GcRequestType,
  status: GcStatusResultType,
  createdAt: DateTimeType,
});

export type RepoGcJob = ValueTypeOf<typeof RepoGcJobType>;
