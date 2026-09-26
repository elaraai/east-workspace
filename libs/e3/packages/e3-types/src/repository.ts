/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A repository's own record: its name, its lifecycle status and when each
 * began.
 */

import {
  VariantType,
  StructType,
  StringType,
  DateTimeType,
  NullType,
  ValueTypeOf,
} from '@elaraai/east';

/**
 * Where a repository is in its lifecycle.
 */
export const RepoStatusType = VariantType({
  /** Being initialised */
  creating: NullType,
  /** Ready for use */
  active: NullType,
  /** A garbage collection is running */
  gc: NullType,
  /** Being deleted */
  deleting: NullType,
});

export type RepoStatus = ValueTypeOf<typeof RepoStatusType>;

/**
 * A repository's metadata.
 */
export const RepoMetadataType = StructType({
  /** The repository's name */
  name: StringType,
  /** Where it is in its lifecycle */
  status: RepoStatusType,
  /** When it was created */
  createdAt: DateTimeType,
  /** When its status last changed */
  statusChangedAt: DateTimeType,
});

export type RepoMetadata = ValueTypeOf<typeof RepoMetadataType>;
