/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A repository's own records: the record of the forms it keeps — the release
 * of e3 that last wrote it, and the store upgrades it has had — and its
 * metadata: its name, its lifecycle status and when each began.
 */

import {
  ArrayType,
  VariantType,
  StructType,
  StringType,
  DateTimeType,
  NullType,
  ValueTypeOf,
} from '@elaraai/east';

/**
 * The repository record: the release of e3 that last wrote it, and the store
 * upgrades the repository has had, which an e3 opening it reads before
 * anything else.
 */
export const RepositoryRecordType = StructType({
  /** The release of e3 that last wrote the record */
  release: StringType,
  /** The store upgrades the repository has had, in the order they were
   *  applied: each by its name, with the release of e3 that applied it */
  upgrades: ArrayType(StructType({ name: StringType, release: StringType })),
});

export type RepositoryRecord = ValueTypeOf<typeof RepositoryRecordType>;

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
