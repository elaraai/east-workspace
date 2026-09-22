/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3: TypeScript SDK for authoring e3 packages.
 *
 * This package provides a fluent API for defining e3 packages in TypeScript:
 * - `e3.input()` - Define input datasets
 * - `e3.task()` - Define tasks that transform datasets
 * - `e3.package()` - Bundle definitions into a package
 * - `e3.export()` - Export package to a .zip bundle
 *
 * Terminology:
 * - **Dataset**: A location holding a value (leaf node in the data tree)
 * - **Tree**: A location containing datasets or nested trees (branch node)
 * - **Structure**: The shape of the data tree
 * - **Task**: A transformation that reads input datasets and produces an output dataset
 * - **Path**: An address pointing to a dataset or tree
 *
 * @example
 * ```ts
 * import { StringType, variant } from '@elaraai/east';
 * import e3 from '@elaraai/e3';
 *
 * const input_name = e3.input('name', StringType, variant('value', 'World'));
 *
 * const say_hello = e3.task(
 *   'say_hello',
 *   [input_name],
 *   ($, name) => str`Hello, ${name}!`
 * );
 *
 * // Only need to pass the final task - dependencies are collected automatically
 * const pkg = e3.package('hello_world', '1.0.0', say_hello);
 *
 * // Discoverable access to package contents
 * pkg.datasets.inputs.name;       // input dataset
 * pkg.datasets.outputs.say_hello; // output dataset
 * pkg.tasks.say_hello;            // task definition
 *
 * await e3.export(pkg, 'package.zip');
 * ```
 */

import type {
  DatasetDef,
  DataTreeDef,
  DatasetsOf,
  FunctionDef,
  MergeDatasets,
  MutationDef,
  PackageDef,
  PackageItem,
  RecordDef,
  RecordIndexDef,
  TaskDef,
} from './types.js';
import { input } from './input.js';
import { record } from './record.js';
import { mutation, editMutation, patchMutation } from './mutation.js';
import { recordIndex } from './record-index.js';
import { task, customTask, partitionTask, streamTask } from './task.js';
import { function_ } from './function.js';
import { package_ } from './package.js';
import { export_ } from './export.js';
// The edit capability's type is the author's to name: an `editMutation` body
// declares it as a parameter type, so the surface that consumes a record must
// be able to spell it without reaching into e3-types.
import { editTypeOf } from '@elaraai/e3-types';

export type {
  DataTreeDef,
  DatasetDef,
  DatasetsOf,
  FunctionDef,
  MutationDef,
  RecordDef,
  RecordIndexDef,
  TaskDef,
  PackageDef,
  PackageItem,
  MergeDatasets,
};

// Runner selection types — see runner.ts for the discriminated-union spec.
export type {
  Runner,
  FunctionRunner,
  Platform,
  EastPyPlatform,
  EastNodePlatform,
  EastCPlatform,
} from './runner.js';
export { runnerToCommand, runnerToVariant, DEFAULT_RUNNER } from './runner.js';

/**
 * The e3 SDK namespace.
 *
 * Provides functions for authoring e3 packages in TypeScript.
 */
const e3 = {
  input,
  record,
  mutation,
  editMutation,
  patchMutation,
  editTypeOf,
  recordIndex,
  task,
  customTask,
  partitionTask,
  streamTask,
  function: function_,
  package: package_,
  export: export_,
};

export default e3;

// Also export individual functions for tree-shaking
export { input, record, mutation, editMutation, patchMutation, recordIndex, task, customTask, partitionTask, streamTask, function_, package_ as package, export_ as export };
export type { PartitionTaskSpec, StreamTaskSpec, EmitOf } from './task.js';

// Singleton tree definitions
export { inputsTree } from './input.js';
export { recordsTree } from './record.js';
export { tasksTree } from './task.js';

// Utility exports
export { type EnvironmentDecl, validateEnvironmentDecl } from './environment.js';
export { captureEnvironment } from './environment-capture.js';
export { sha256File, sha256Bytes, hashToPath } from './sha256.js';
export {
  readDatasetFileHeader,
  readDatasetFileType,
  DatasetFileTypeMismatchError,
  type DatasetFileHeader,
} from './dataset-file.js';
export { DatasetSourceType, type DatasetSource } from './input.js';
export { addObject } from './export.js';
export { editTypeOf } from '@elaraai/e3-types';
export { indexBuildProgram, buildMutationProgram, deltaTargets, indexEntryKeyType } from './record-programs.js';
export type { RecordIndexSpec, IndexFunction } from './record-index.js';
