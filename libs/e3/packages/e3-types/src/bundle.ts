/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A workspace bundle: a workspace as it is, in one stream of beast2, which a
 * repository in any store makes a workspace from — the package deployed to
 * it, every dataset's ref, the executions its tasks' outputs come from, and
 * every object they reach.
 *
 * A bundle is a {@link WorkspaceBundleType}, written an entry at a time and
 * read a segment at a time (East's `Beast2ElementWriter` and
 * `decodeBeast2ElementsFor`), so a bundle of any size is written and read in
 * the memory of a few entries. Its first entry is the workspace's, and every
 * entry after it is an object, or a piece of one. Its type is in its header,
 * as every beast2 value's is, so a reader refuses a bundle of another form
 * naming both, and a new kind of entry is one more case.
 */

import { ArrayType, BlobType, DateTimeType, DictType, StringType, StructType, VariantType, type ValueTypeOf } from '@elaraai/east';
import { DatasetRefType } from './dataset-ref.js';
import { ExecutionStatusType } from './execution.js';

/**
 * What a bundle says of its workspace, ahead of any object.
 */
export const WorkspaceBundleHeadType = StructType({
  /** The package deployed to the workspace: its name and version, and its
   *  object */
  package: StructType({
    name: StringType,
    version: StringType,
    hash: StringType,
  }),
  /** When the package was deployed */
  deployedAt: DateTimeType,
  /** Every dataset's ref, by the path its store keys it by (`inputs/sales`):
   *  a record's state and the head of its history among them */
  datasets: DictType(StringType, DatasetRefType),
  /** The executions the tasks' outputs come from: each task's latest attempt
   *  over its current inputs, where it succeeded and made the output the
   *  workspace holds */
  executions: ArrayType(StructType({
    /** The task object's hash */
    taskHash: StringType,
    /** The hash of the inputs it ran over */
    inputsHash: StringType,
    /** Its record, which names its id */
    status: ExecutionStatusType,
  })),
});

export type WorkspaceBundleHead = ValueTypeOf<typeof WorkspaceBundleHeadType>;

/**
 * An entry of a bundle.
 */
export const WorkspaceBundleEntryType = VariantType({
  /** The workspace: a bundle's first entry, and its only one of this kind */
  workspace: WorkspaceBundleHeadType,
  /** An object's bytes: the whole object, or the last of its pieces */
  object: BlobType,
  /** A piece of an object too large for one entry: the object goes on in the
   *  entries after it, and ends at an `object` */
  piece: BlobType,
});

export type WorkspaceBundleEntry = ValueTypeOf<typeof WorkspaceBundleEntryType>;

/**
 * A workspace bundle: its entries, in order.
 */
export const WorkspaceBundleType = ArrayType(WorkspaceBundleEntryType);

export type WorkspaceBundle = ValueTypeOf<typeof WorkspaceBundleType>;
