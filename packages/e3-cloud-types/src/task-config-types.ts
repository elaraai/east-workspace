/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Task configuration type definitions for per-task compute sizing and timeouts.
 *
 * Types:
 * - ComputeSizeType: Compute tier for task execution (serverless, small, medium, large, xlarge)
 * - TaskTimeoutType: Custom timeout configuration for a task
 * - ComputeConfigMapType: Dictionary of task name → compute size
 * - TimeoutConfigMapType: Dictionary of task name → timeout
 */

import {
  StructType,
  VariantType,
  NullType,
  StringType,
  IntegerType,
  DictType,
  type ValueTypeOf,
} from '@elaraai/east';

/**
 * Compute tier for task execution.
 *
 * - serverless: Lambda (default, ~1.8 GB RAM)
 * - small: Fargate 1 vCPU / 2 GB
 * - medium: Fargate 2 vCPU / 8 GB
 * - large: Fargate 4 vCPU / 16 GB
 * - xlarge: Fargate 8 vCPU / 32 GB
 */
export const ComputeSizeType = VariantType({
  serverless: NullType,
  small: NullType,
  medium: NullType,
  large: NullType,
  xlarge: NullType,
});
export type ComputeSize = ValueTypeOf<typeof ComputeSizeType>;

/**
 * Custom timeout configuration for a task.
 */
export const TaskTimeoutType = StructType({
  minutes: IntegerType,
});
export type TaskTimeout = ValueTypeOf<typeof TaskTimeoutType>;

/**
 * Dictionary of task name → compute size.
 */
export const ComputeConfigMapType = DictType(StringType, ComputeSizeType);
export type ComputeConfigMap = ValueTypeOf<typeof ComputeConfigMapType>;

/**
 * Dictionary of task name → timeout.
 */
export const TimeoutConfigMapType = DictType(StringType, TaskTimeoutType);
export type TimeoutConfigMap = ValueTypeOf<typeof TimeoutConfigMapType>;

/**
 * Combined task configs (compute + timeout) for unified endpoint.
 */
export const TaskConfigsType = StructType({
  compute: ComputeConfigMapType,
  timeout: TimeoutConfigMapType,
});
export type TaskConfigs = ValueTypeOf<typeof TaskConfigsType>;
