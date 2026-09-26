/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Package object types for e3.
 *
 * A package bundles everything needed to run computations:
 * tasks and data structure with initial values.
 *
 * Terminology:
 * - **Package**: A deployable bundle of tasks and data structure
 * - **Structure**: The shape of the data tree
 * - **Task**: A computation with input/output paths (stored separately)
 */

import { StructType, StringType, IntegerType, VariantType, NullType, DictType, ValueTypeOf, decodeBeast2For } from '@elaraai/east';
import { DatasetRefType } from './dataset-ref.js';
import { StructureType } from './structure.js';

/**
 * Data configuration in a package.
 *
 * Defines the structure (which paths are datasets vs trees)
 * and initial values (root tree hash).
 *
 * @remarks
 * - `structure`: Defines which paths are datasets vs trees (recursive)
 * - `refs`: Per-dataset refs mapping refPath to DatasetRef (replaces old root tree hash)
 */
export const PackageDataType = StructType({
  /** Structure defining tree shape (what's a group vs dataset) */
  structure: StructureType,
  /** Per-dataset refs: refPath (e.g. "inputs/greeting") -> DatasetRef */
  refs: DictType(StringType, DatasetRefType),
});
export type PackageDataType = typeof PackageDataType;

export type PackageData = ValueTypeOf<typeof PackageDataType>;

/**
 * Package object stored in the object store.
 *
 * Packages are the unit of distribution and deployment in e3.
 * They are immutable and content-addressed by their hash.
 *
 * @remarks
 * - `tasks`: Maps task names to task object hashes. Each task object
 *   contains runner, input paths, and output path.
 * - `data`: The structure and initial values for the data tree.
 *
 * Package identity (name/version) is determined by the path in the
 * bundle's `packages/<name>/<version>` directory structure.
 *
 * @example
 * ```ts
 * const pkg: PackageObject = {
 *   tasks: new Map([['process', 'abc123...']]),  // hash of TaskObject
 *   data: {
 *     structure: variant('struct', new Map([...])),
 *     refs: new Map([['inputs/sales', variant('value', { hash: 'def456...', versions: new Map() })]]),
 *   },
 * };
 * ```
 */
/**
 * Where a dataset's initial value comes from, when it is not in the package.
 *
 * @remarks
 * A package carries the DESCRIPTOR, never the bytes: `e3.input('table', T,
 * variant('file', './TABLE.beast2'))` puts `{ file: { path } }` here and leaves
 * the ref `unassigned`, and deploy resolves it — adopting the file into the
 * object store by hash, so a new delivery under the same path is a new hash
 * whose consumers re-run. An inline `variant('value', v)` needs no descriptor:
 * its bytes are an object in the bundle like any other.
 *
 * A variant so that further source kinds can be appended later without a wire
 * break; `file` is the only one today.
 */
export const DatasetSourceWireType = VariantType({
  /** A path on the machine that DEPLOYS the package, resolved at deploy. */
  file: StructType({ path: StringType }),
});
export type DatasetSourceWireType = typeof DatasetSourceWireType;
export type DatasetSourceWire = ValueTypeOf<typeof DatasetSourceWireType>;

export const PackageObjectType = StructType({
  /** Tasks defined in this package: name -> task object hash */
  tasks: DictType(StringType, StringType),
  /** Data structure and initial values */
  data: PackageDataType,
  /** Functions defined in this package: name -> FunctionObject hash. */
  functions: DictType(StringType, StringType),
  /** Records defined in this package: name -> RecordObject hash. */
  records: DictType(StringType, StringType),
  /** Unresolved dataset sources: refPath (e.g. "inputs/table") -> descriptor. */
  sources: DictType(StringType, DatasetSourceWireType),
});
export type PackageObjectType = typeof PackageObjectType;

export type PackageObject = ValueTypeOf<typeof PackageObjectType>;

const decodeCurrent = decodeBeast2For(PackageObjectType);

/**
 * Decode a `PackageObject` from BEAST2 bytes.
 *
 * @remarks
 * A package-borne wire, so it changes by hard cutover: a package exported by
 * an older SDK is re-exported with the current one, and this says so.
 *
 * @param data - the stored bytes
 * @returns the package object
 * @throws {Error} When the bytes are not a current package object — a package
 *   exported by an older SDK, which is re-exported with the current one.
 */
export function decodePackageObject(data: Uint8Array): PackageObject {
  try {
    return decodeCurrent(data);
  } catch (err) {
    throw new Error(
      `the package object does not decode: the package was exported by an older e3 SDK — re-export it with the current one ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

// =============================================================================
// Package Transfer Types
// =============================================================================

export const PackageTransferInitRequestType = StructType({
  size: IntegerType,
});
export type PackageTransferInitRequest = ValueTypeOf<typeof PackageTransferInitRequestType>;

export const PackageTransferInitResponseType = StructType({
  id: StringType,
  uploadUrl: StringType,
});
export type PackageTransferInitResponse = ValueTypeOf<typeof PackageTransferInitResponseType>;

export const PackageJobResponseType = StructType({
  id: StringType,
});
export type PackageJobResponse = ValueTypeOf<typeof PackageJobResponseType>;

export const PackageImportResultType = StructType({
  name: StringType,
  version: StringType,
  packageHash: StringType,
  objectCount: IntegerType,
});
export type PackageImportResult = ValueTypeOf<typeof PackageImportResultType>;

export const PackageExportResultType = StructType({
  downloadUrl: StringType,
  size: IntegerType,
});
export type PackageExportResult = ValueTypeOf<typeof PackageExportResultType>;

export const PackageImportProgressType = VariantType({
  pending: NullType,
  downloading: NullType,
  importing: StructType({ objectsProcessed: IntegerType }),
});
export type PackageImportProgress = ValueTypeOf<typeof PackageImportProgressType>;

export const PackageImportStatusType = VariantType({
  processing: PackageImportProgressType,
  completed: PackageImportResultType,
  failed: StructType({
    message: StringType,
  }),
});
export type PackageImportStatus = ValueTypeOf<typeof PackageImportStatusType>;

export const PackageExportProgressType = VariantType({
  pending: NullType,
  exporting: StructType({ objectsProcessed: IntegerType }),
  uploading: NullType,
});
export type PackageExportProgress = ValueTypeOf<typeof PackageExportProgressType>;

export const PackageExportStatusType = VariantType({
  processing: PackageExportProgressType,
  completed: PackageExportResultType,
  failed: StructType({
    message: StringType,
  }),
});
export type PackageExportStatus = ValueTypeOf<typeof PackageExportStatusType>;
