/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Workspace state type definitions.
 *
 * A workspace is a mutable working copy of a package. Its record is `none`
 * from its creation until a package is deployed to it, and then its state:
 * which package was deployed, when, and the latest dataflow run.
 *
 * A local repository keeps the record at `workspaces/<name>.beast2`.
 */

import { StructType, StringType, DateTimeType, OptionType, ValueTypeOf } from '@elaraai/east';

/**
 * A deployed workspace's state.
 *
 * Future audit trail support:
 * When we implement full audit trail, this state will move to the object
 * store (content-addressed) with a ref file pointing to current state hash.
 * Additional fields for the Merkle chain:
 *
 *   previousStateHash: NullableType(StringType),  // null for initial deploy
 *   message: StringType,  // "deployed package X", "user Y wrote to dataset Z"
 *
 * This gives a complete history of workspace changes, similar to git commits.
 */
export const WorkspaceStateType = StructType({
  /** Name of the deployed package */
  packageName: StringType,
  /** Version of the deployed package */
  packageVersion: StringType,
  /** Hash of the package object at deploy time (immutable reference) */
  packageHash: StringType,
  /** UTC datetime when the package was deployed */
  deployedAt: DateTimeType,
  /** Run ID of the latest completed dataflow run (null if never run) */
  currentRunId: OptionType(StringType),
});

export type WorkspaceState = ValueTypeOf<typeof WorkspaceStateType>;

/**
 * A workspace's record: `none` until a package is deployed to it, and then
 * its state.
 */
export const WorkspaceRecordType = OptionType(WorkspaceStateType);

export type WorkspaceRecord = ValueTypeOf<typeof WorkspaceRecordType>;
