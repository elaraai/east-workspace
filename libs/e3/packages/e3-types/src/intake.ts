/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How far a file being taken into the store has got: a deploy's file source,
 * or an upload's delivery as its commit takes it in.
 *
 * A file is hashed first, since its SHA-256 is how the store knows a delivery
 * it already holds, and then taken in: its segments carried as the Writer
 * wrote them, or, for a file another writer wrote, read and written again.
 */

import { BooleanType, IntegerType, NullType, StringType, StructType, VariantType, type ValueTypeOf } from '@elaraai/east';

/**
 * The step a file being taken in is at.
 */
export const IntakeStepType = VariantType({
  /** Not started: a deploy takes a bounded number of files in at once */
  waiting: NullType,
  /** Being read for its SHA-256, by which the store knows a delivery it
   *  already holds */
  hashing: NullType,
  /** Being taken in: `foreign` when it is read and written again, rather than
   *  carried as the Writer wrote it */
  taking_in: StructType({ foreign: BooleanType }),
  /** In the store: one it already held, carried, or written again */
  done: VariantType({ known: NullType, carried: NullType, written: NullType }),
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
  /** Bytes of the file its step has read; its size once it is done */
  bytes: IntegerType,
  /** The file's size */
  total: IntegerType,
});

export type IntakeFile = ValueTypeOf<typeof IntakeFileType>;
