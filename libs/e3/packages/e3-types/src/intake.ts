/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How far a file being taken into the store has got: a deploy's file source,
 * or an upload's delivery as its commit takes it in.
 *
 * A file is hashed first, since its SHA-256 is how the store knows a delivery
 * it already holds, and then taken in: a collection by intake units on the
 * runners, a piece of its segments each, and any other value as the object the
 * file is.
 */

import { ArrayType, IntegerType, NullType, StringType, StructType, VariantType, type ValueTypeOf } from '@elaraai/east';

/**
 * The step a file being taken in is at.
 */
export const IntakeStepType = VariantType({
  /** Not started: a deploy takes a bounded number of files in at once */
  waiting: NullType,
  /** Being read for its SHA-256, by which the store knows a delivery it
   *  already holds */
  hashing: NullType,
  /** Being taken in by intake units: its `pieces`, and how many are `done` */
  taking_in: StructType({ pieces: IntegerType, done: IntegerType }),
  /** In the store: one it already held; a value that is not a collection,
   *  carried as the object the file is; or a collection, taken in by the
   *  runners named, in the order each first took a piece in — none when every
   *  piece was taken in before, by an intake that stopped part way */
  done: VariantType({ known: NullType, carried: NullType, taken: ArrayType(StringType) }),
});

export type IntakeStep = ValueTypeOf<typeof IntakeStepType>;

/**
 * A file being taken into the store.
 */
export const IntakeFileType = StructType({
  /** The dataset it becomes, as `inputs/<name>` */
  path: StringType,
  /** The step it is at */
  step: IntakeStepType,
  /** Bytes of the file its step has covered: read for its hash, or covered by
   *  the pieces taken in; its size once it is done */
  bytes: IntegerType,
  /** The file's size */
  total: IntegerType,
});

export type IntakeFile = ValueTypeOf<typeof IntakeFileType>;
