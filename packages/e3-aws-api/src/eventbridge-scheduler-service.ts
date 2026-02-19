/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS EventBridge Scheduler implementation of SchedulerService.
 */

import {
  SchedulerClient,
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import type { SchedulerService } from '@elaraai/e3-cloud-core';

export class EventBridgeSchedulerService implements SchedulerService {
  constructor(
    private readonly scheduler: SchedulerClient,
    private readonly groupName: string,
  ) {}

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
