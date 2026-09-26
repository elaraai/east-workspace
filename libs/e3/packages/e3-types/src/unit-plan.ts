/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The unit graph of a task split into pieces, a stage at a time.
 *
 * A split task runs in stages: its pieces, and then, for a set, a dict or a
 * fold, each level of the merges that assemble their outputs. Each stage's
 * units are one of these objects, written when the stage starts and named by
 * the task's entry in the dataflow's execution state. So resuming a stage reads
 * this object back, and finds the units that finished in the execution cache.
 * Each names the plan of the stage before it, and the task's `success` record
 * names the last, so every stage the task ran is found from its record, and
 * with them the units gc keeps beside it.
 *
 * It names other objects, so it carries a `kind` tag the garbage collector
 * dispatches on.
 *
 * @packageDocumentation
 */

import { ArrayType, IntegerType, OptionType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, type ValueTypeOf } from '@elaraai/east';

/** The kind tag every unit plan carries. */
export const UNIT_PLAN_KIND = '$plan';

/** Parts a merge level assembles into one: a group of the pieces' outputs
 *  whose keys overlap, over one key range, or a fold's partials. */
export const UnitPlanGroupType = StructType({
  /** The hash of the key range the group's merges run over — `{from, to}`
   *  over the parts' key type — or `none` to merge the parts whole. */
  range: OptionType(StringType),
  /** The parts, in the order they fold: each unit of the level merges a run
   *  of them, and a run of one passes through. */
  entries: ArrayType(StringType),
});
export type UnitPlanGroupType = typeof UnitPlanGroupType;
export type UnitPlanGroup = ValueTypeOf<typeof UnitPlanGroupType>;

/**
 * A stage of a split task.
 *
 * - `pieces`: each piece's inputs, in the task's input order — a partitioned
 *   input's piece of it, and every other input as it is.
 * - `merge`: one level of the merges that assemble the pieces' outputs, and
 *   the groups it merges, in key order.
 */
export const UnitPlanStageType = VariantType({
  pieces: ArrayType(ArrayType(StringType)),
  merge: StructType({
    /** The level, from 1. */
    level: IntegerType,
    /** The number of levels the merges take. */
    levels: IntegerType,
    /** The groups, in key order. */
    groups: ArrayType(UnitPlanGroupType),
  }),
});
export type UnitPlanStageType = typeof UnitPlanStageType;
export type UnitPlanStage = ValueTypeOf<typeof UnitPlanStageType>;

/**
 * A stage of a split task's unit graph, stored as an object.
 *
 * @example
 * ```ts
 * import { none, variant } from '@elaraai/east';
 *
 * const plan: UnitPlan = {
 *   kind: UNIT_PLAN_KIND,
 *   task: '5e7a3b…',
 *   inputs: '9c01de…',
 *   stage: variant('pieces', [['a1b2…'], ['c3d4…']]),
 *   previous: none,
 *   peakBytes: none,
 * };
 * ```
 */
export const UnitPlanType = StructType({
  /** Always {@link UNIT_PLAN_KIND}. */
  kind: StringType,
  /** The task object's hash. */
  task: StringType,
  /** The task's inputs hash: the execution the plan belongs to. */
  inputs: StringType,
  /** The stage. */
  stage: UnitPlanStageType,
  /** The plan of the stage before this one; `none` for the pieces. */
  previous: OptionType(StringType),
  /** The largest peak resident memory, in bytes, a unit of the stages before
   *  this one reached, as their execution records hold it; `none` for the
   *  pieces, or when no unit reported one. A task taken up at this stage
   *  starts its own peak from it, so its record counts every stage wherever
   *  it was taken up. */
  peakBytes: OptionType(IntegerType),
});
export type UnitPlanType = typeof UnitPlanType;
export type UnitPlan = ValueTypeOf<typeof UnitPlanType>;

/** Encodes a {@link UnitPlanType} object for the object store. */
export const encodeUnitPlan: (plan: UnitPlan) => Uint8Array = encodeBeast2For(UnitPlanType);

const decodeUnitPlanValue = decodeBeast2For(UnitPlanType);

/**
 * Decodes a unit plan.
 *
 * @param data - the stored bytes
 * @returns the plan
 * @throws {Error} When the bytes are not a unit plan, or carry another kind
 *   tag.
 */
export function decodeUnitPlan(data: Uint8Array): UnitPlan {
  const plan = decodeUnitPlanValue(data);
  if (plan.kind !== UNIT_PLAN_KIND) {
    throw new Error(`the object is not a unit plan: its kind is '${plan.kind}', not '${UNIT_PLAN_KIND}'`);
  }
  return plan;
}
