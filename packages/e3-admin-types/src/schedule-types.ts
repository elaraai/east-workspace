/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Schedule type definitions for recurring dataflow execution.
 *
 * Types:
 * - TriggeredByType: How a dataflow run was initiated (schedule vs user)
 * - ScheduleType: Full schedule data model stored in DynamoDB
 * - ScheduleRequestType: PUT request body for creating/updating schedules
 */

import {
  StructType,
  VariantType,
  StringType,
  BooleanType,
  ArrayType,
  OptionType,
  type ValueTypeOf,
} from '@elaraai/east';

/**
 * How a dataflow run was initiated.
 *
 * - schedule: Triggered by EventBridge Scheduler
 * - user: Triggered manually via API
 */
export const TriggeredByType = VariantType({
  schedule: StructType({
    schedulerExecutionId: StringType,
    scheduledTime: StringType,
  }),
  user: StructType({
    userId: StringType,
    email: StringType,
  }),
});

export type TriggeredBy = ValueTypeOf<typeof TriggeredByType>;

/**
 * Schedule data model.
 *
 * Stored in DynamoDB at PK: SCHEDULE/{repo}, SK: {workspace}
 */
export const ScheduleType = StructType({
  repo: StringType,
  workspace: StringType,
  cronExpression: StringType,
  timezone: StringType,
  forceTasks: ArrayType(StringType),
  enabled: BooleanType,
  description: OptionType(StringType),
  createdBy: StringType,
  createdAt: StringType,
  updatedAt: StringType,
  schedulerName: StringType,
});

export type Schedule = ValueTypeOf<typeof ScheduleType>;

/**
 * PUT request body for creating or updating a schedule.
 */
export const ScheduleRequestType = StructType({
  cronExpression: StringType,
  timezone: OptionType(StringType),
  forceTasks: ArrayType(StringType),
  enabled: BooleanType,
  description: OptionType(StringType),
});

export type ScheduleRequest = ValueTypeOf<typeof ScheduleRequestType>;
