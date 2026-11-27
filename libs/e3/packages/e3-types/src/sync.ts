/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a sync says of part of a workspace: which part (a selection), and the
 * part as an origin describes it to a replica (a description).
 *
 * A description is a workspace bundle's head for part of a workspace, with
 * one difference: the replica's package travels as a value. A partial
 * replica's package holds only the selection's tasks, so it is an object the
 * origin does not hold, and the replica writes it itself. Every task in it is
 * named by the task object's hash the origin's package names it by, so a
 * task's hash, and every execution's identity, is the origin's.
 */

import { ArrayType, DateTimeType, DictType, NullType, StringType, StructType, VariantType, type ValueTypeOf } from '@elaraai/east';
import { DatasetRefType } from './dataset-ref.js';
import { ExecutionStatusType } from './execution.js';
import { PackageObjectType } from './package.js';
import { DataManifestType } from './task.js';

/**
 * What a selection uses of a record it binds: the mutations it binds and the
 * indexes it reads through.
 */
export const SyncRecordUseType = StructType({
  /** The record's name */
  record: StringType,
  /** The mutations bound, by name */
  mutations: ArrayType(StringType),
  /** The indexes read through, by name */
  indexes: ArrayType(StringType),
});

export type SyncRecordUse = ValueTypeOf<typeof SyncRecordUseType>;

/**
 * Which part of a workspace a replica holds.
 */
export const SyncSelectionType = VariantType({
  /** The whole workspace */
  full: NullType,
  /** What a list of tasks and a set of bindings need */
  partial: StructType({
    /** The tasks, by name: each with what it reads */
    tasks: ArrayType(StringType),
    /** What is read with no task: dataset paths, functions, records, and
     *  datasets read a window at a time */
    binds: DataManifestType,
    /** What is used of each record bound */
    records: ArrayType(SyncRecordUseType),
  }),
});

export type SyncSelection = ValueTypeOf<typeof SyncSelectionType>;

/**
 * A selection of a workspace as its origin describes it: what a replica is
 * made from.
 */
export const SyncDescriptionType = StructType({
  /** The e3 release that wrote it (`E3_RELEASE`) */
  release: StringType,
  /** The origin workspace's package: its name, version and object */
  origin: StructType({
    name: StringType,
    version: StringType,
    hash: StringType,
  }),
  /** The replica's own package, as a value: the selection's tasks, by the
   *  hashes the origin's package names them by */
  package: PackageObjectType,
  /** When the origin's package was deployed */
  deployedAt: DateTimeType,
  /** Each dataset the replica is given, by the path its store keys it by
   *  (`inputs/sales`) */
  datasets: DictType(StringType, DatasetRefType),
  /** Successes the origin holds for the selection's tasks */
  executions: ArrayType(StructType({
    /** The task object's hash */
    taskHash: StringType,
    /** The hash of the inputs it ran over */
    inputsHash: StringType,
    /** Its record, which names its id */
    status: ExecutionStatusType,
  })),
});

export type SyncDescription = ValueTypeOf<typeof SyncDescriptionType>;
