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
  ArrayType,
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
  GcRequestType, GcStatusResultType, InputPolicyType, IntakeFileType, PackageImportProgressType, PackageExportProgressType,
  SchemaPolicyType, SplitCallPlanType, SplitCallProgressType, TreePathType, WorkspaceDeployStatusType,
} from '@elaraai/e3-types';
import { SplitCallOutcomeType } from '../execution/splitCall.js';
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
 * `processing` while the staged bytes are verified and taken in, with how far
 * it has got once the store has said; `completed` once the dataset names them;
 * `failed`, naming why, when they are not the upload's bytes or cannot be
 * taken in; and `type_mismatch` when they are not of the type the dataset
 * declares, which the API answers as its `dataset_type_mismatch` error.
 */
export const DatasetCommitStatusType = VariantType({
  processing: OptionType(IntakeFileType),
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

/**
 * How far an export has written a package zip: what a caller keeps when it
 * stops an export part way — compute with a time limit, at its deadline — and
 * resumes the export from.
 *
 * @remarks
 * A zip's entries are written one after another, each whole, and its
 * directory last, from every entry's record. A checkpoint holds the records of
 * the entries written, in order, and the bytes they fill. An export resumed
 * from it writes the entries after them, to a destination that holds those
 * bytes, and the zip is the one an export never stopped writes. It names the
 * release that wrote it and the package the zip carries: an export by another
 * release, or of a package that changed since, refuses it.
 */
export const PackageZipCheckpointType = StructType({
  /** The release of e3 that wrote the zip's entries. */
  release: StringType,
  /** The package object the zip carries. */
  packageHash: StringType,
  /** The bytes of the zip written: every entry below, and nothing after. */
  bytes: IntegerType,
  /** The entries written, in order: each one's name, its bytes' CRC-32, its
   *  size, and where its local header starts. */
  entries: ArrayType(StructType({
    name: StringType,
    crc32: IntegerType,
    size: IntegerType,
    offset: IntegerType,
  })),
});

export type PackageZipCheckpoint = ValueTypeOf<typeof PackageZipCheckpointType>;

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
  inputs: InputPolicyType,
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

// =============================================================================
// Split Call
// =============================================================================

/**
 * How a split call's job stands, as a store keeps it for a poll: `processing`,
 * with how far it has got once it has said; `completed`, with what it came to
 * — hashes, not values ({@link SplitCallOutcomeType}); `planned`, an
 * explain's pieces; or `failed`, naming why e3 could not run it.
 */
export const SplitCallJobStatusType = VariantType({
  processing: OptionType(SplitCallProgressType),
  completed: SplitCallOutcomeType,
  planned: SplitCallPlanType,
  failed: StructType({ message: StringType }),
});

/**
 * A split call's job, as a store keeps it: the task its launch wrote and the
 * inputs it runs over, which of them are `object` arguments, `then`'s IR
 * bundle, the call's limits, what the call read, which its result names,
 * whether it only plans the call's pieces, and whether a caller whose one-shot
 * grant is `platform_free` may poll it.
 *
 * @remarks
 * Every field is a hash, a number or a flag, so a store with small records
 * keeps it whatever the call's arguments and result weigh. The job's timeout
 * is one budget, counted from `createdAt`, however many calls run it.
 */
export const SplitCallJobType = StructType({
  repo: StringType,
  workspace: StringType,
  task: StringType,
  inputs: ArrayType(StringType),
  /** The indexes of the call's `object` arguments: the job re-references what
   *  each names before it runs, which the launch never reads. */
  objects: ArrayType(IntegerType),
  then: OptionType(StringType),
  limits: StructType({ timeoutMs: IntegerType, maxResultBytes: IntegerType, maxLogBytes: IntegerType }),
  read: ArrayType(StructType({ path: TreePathType, hash: StringType })),
  /** Whether the job is an explain's: it plans the call's pieces, stores them
   *  for the run to take up, and runs no unit. */
  explain: BooleanType,
  /** Whether a `platform_free` caller may poll it: the call is platform-free,
   *  or a `platform_free` caller launched it. */
  platformFree: BooleanType,
  status: SplitCallJobStatusType,
  createdAt: DateTimeType,
});

export type SplitCallJob = ValueTypeOf<typeof SplitCallJobType>;
