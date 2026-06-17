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

// Backwards compatibility alias
/** @deprecated Use PackageDataType instead */
export const PackageDatasetsType = PackageDataType;
/** @deprecated Use PackageData instead */
export type PackageDatasetsType = PackageDataType;
/** @deprecated Use PackageData instead */
export type PackageDatasets = PackageData;

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
export const PackageObjectType = StructType({
  /** Tasks defined in this package: name -> task object hash */
  tasks: DictType(StringType, StringType),
  /** Data structure and initial values */
  data: PackageDataType,
  /** Functions defined in this package: name -> FunctionObject hash. */
  functions: DictType(StringType, StringType),
  /** Records defined in this package: name -> RecordObject hash.
   *  BEAST2 encodes struct fields positionally in declaration order, so new
   *  fields MUST be appended LAST — never inserted between existing fields. */
  records: DictType(StringType, StringType),
});
export type PackageObjectType = typeof PackageObjectType;

export type PackageObject = ValueTypeOf<typeof PackageObjectType>;

/**
 * The pre-`records` package object wire shape (tasks, data, functions), kept
 * only so {@link decodePackageObject} can read packages exported before records
 * existed.
 */
const FunctionsEraPackageObjectType = StructType({
  tasks: DictType(StringType, StringType),
  data: PackageDataType,
  functions: DictType(StringType, StringType),
});

/**
 * The pre-`functions` package object wire shape (tasks, data), kept only so
 * {@link decodePackageObject} can read packages exported before functions
 * existed.
 */
const LegacyPackageObjectType = StructType({
  tasks: DictType(StringType, StringType),
  data: PackageDataType,
});

const decodeCurrent = decodeBeast2For(PackageObjectType);
const decodeFunctionsEra = decodeBeast2For(FunctionsEraPackageObjectType);
const decodeLegacy = decodeBeast2For(LegacyPackageObjectType);

/**
 * Decode a `PackageObject` from BEAST2 bytes, tolerating the two older wire
 * formats (dual-decode migration).
 *
 * Every package-read path — local AND cloud — must use this instead of
 * `decodeBeast2For(PackageObjectType)` directly, so packages exported before
 * the `records`/`functions` fields existed keep decoding. Older bytes decode
 * with the missing maps defaulted to empty.
 */
export function decodePackageObject(data: Uint8Array): PackageObject {
  try {
    return decodeCurrent(data);
  } catch (err) {
    try {
      const fnEra = decodeFunctionsEra(data);
      return { tasks: fnEra.tasks, data: fnEra.data, functions: fnEra.functions, records: new Map() };
    } catch {
      try {
        const legacy = decodeLegacy(data);
        return { tasks: legacy.tasks, data: legacy.data, functions: new Map(), records: new Map() };
      } catch {
        throw err; // no known shape — surface the current-format error
      }
    }
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
