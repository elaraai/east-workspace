/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record object types for e3.
 *
 * An `e3.record` is a root dataset whose writes go through named, typed, pure
 * East **mutations** rather than blind replace. Each committed mutation appends
 * a content-addressed commit object, so a record's history is a git-style chain
 * — the audit trail of who changed what, when, superseding which state.
 *
 * The record's current state is an ordinary `value` dataset ref (its `hash`
 * points at the plain state blob), so every existing read path — task inputs,
 * `e3 get`, the UI `Data.bind` read — works on records unchanged. Only the
 * write protocol differs.
 */

import { StructType, StringType, OptionType, DateTimeType, ArrayType, DictType, EastTypeType, ValueTypeOf } from '@elaraai/east';
import { RunnerType } from './runner.js';

/**
 * A single commit in a record's history.
 *
 * Commits are ordinary content-addressed objects; a typical one is a few
 * hundred bytes. The record ref's version-vector self-entry carries the commit
 * hash (not the state hash), so change detection is commit-granular and there
 * is no ABA even when a mutation reproduces an earlier state.
 */
export const RecordCommitType = StructType({
  /** Previous commit hash; none for the genesis commit. */
  parent: OptionType(StringType),
  /** Hash of the state blob this commit produced (== the ref's value.hash). */
  state: StringType,
  /** Mutation name; `$init` for genesis, `$compact` for snapshot rewrites. */
  mutation: StringType,
  /** Hash of the beast2-encoded args tuple; none when the mutation has no args. */
  args: OptionType(StringType),
  /** Caller identity (auth principal / `cli:<user>`); best-effort string. */
  actor: StringType,
  /** Commit wall-clock time. */
  at: DateTimeType,
});
export type RecordCommitType = typeof RecordCommitType;
export type RecordCommit = ValueTypeOf<typeof RecordCommitType>;

/**
 * A mutation: the write half of the function machinery (CQRS — `e3.function`
 * is the read/query half). A mutation is a pure East reducer
 * `(State, ...Args) => State` run where the data is, in a compare-and-swap
 * retry loop. Its output type IS the owning record's type, so — unlike a
 * {@link FunctionObjectType} — there is no separate `outputType` field.
 */
export const MutationObjectType = StructType({
  /** Hash of the encoded EastIR bundle (encodeEastIR), like a function's bodyIr. */
  bodyIr: StringType,
  /** The EXTRA positional parameter types after the state parameter. */
  argTypes: ArrayType(EastTypeType),
  /** Author-chosen runtime; resolved to argv by runnerToArgv. */
  runner: RunnerType,
});
export type MutationObjectType = typeof MutationObjectType;
export type MutationObject = ValueTypeOf<typeof MutationObjectType>;

/**
 * Record object stored in the object store, referenced by name from
 * `PackageObject.records`. Carries the record's dataset path and its mutations.
 */
export const RecordObjectType = StructType({
  /** refPath of the record's dataset, e.g. `records/orders`. */
  path: StringType,
  /** Mutations by name -> MutationObject hash. */
  mutations: DictType(StringType, StringType),
});
export type RecordObjectType = typeof RecordObjectType;
export type RecordObject = ValueTypeOf<typeof RecordObjectType>;
