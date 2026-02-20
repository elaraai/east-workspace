/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS EventBridge Scheduler implementation of SchedulerService.
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
  ConflictException,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import type { SchedulerService } from '@elaraai/e3-cloud-core';

export class EventBridgeSchedulerService implements SchedulerService {
  constructor(
    private readonly scheduler: SchedulerClient,
    private readonly groupName: string,
    private readonly roleArn: string,
    private readonly targetArn: string,
    private readonly dlqArn?: string,
  ) {}

  async upsertSchedule(params: {
    name: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    description: string;
    targetInput: string;
  }): Promise<void> {
    const scheduleParams = {
      Name: params.name,
      GroupName: this.groupName,
      ScheduleExpression: params.cronExpression,
      ScheduleExpressionTimezone: params.timezone,
      State: params.enabled ? 'ENABLED' as const : 'DISABLED' as const,
      Target: {
        Arn: this.targetArn,
        RoleArn: this.roleArn,
        Input: params.targetInput,
        RetryPolicy: {
          MaximumRetryAttempts: 2,
          MaximumEventAgeInSeconds: 3600,
        },
        ...(this.dlqArn ? { DeadLetterConfig: { Arn: this.dlqArn } } : {}),
      },
      FlexibleTimeWindow: {
        Mode: 'OFF' as const,
      },
      Description: params.description,
    };

    // Create or update: try create first, fall back to update on conflict
    try {
      await this.scheduler.send(new CreateScheduleCommand(scheduleParams));
    } catch (err) {
      if (err instanceof ConflictException) {
        await this.scheduler.send(new UpdateScheduleCommand(scheduleParams));
      } else {
        throw err;
      }
    }
  }

  async deleteSchedule(schedulerName: string): Promise<void> {
    try {
      await this.scheduler.send(new DeleteScheduleCommand({
        Name: schedulerName,
        GroupName: this.groupName,
      }));
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) {
        throw err;
      }
    }
  }
}
