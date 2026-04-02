/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete Cloud Resources Lambda Handler — thin wrapper.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { DynamoAclStore, DynamoScheduleStore, DynamoTaskConfigStore, DynamoUserSettingsStore } from '../../storage/index.js';
import { EventBridgeSchedulerService } from '../../services/eventbridge-scheduler.js';
import { handleDeleteCloudResources } from '@elaraai/e3-cloud-core/deletion';
import type { DeleteCloudResourcesInput, DeleteCloudResourcesOutput } from '@elaraai/e3-cloud-core/deletion';

const dynamo = new DynamoDBClient({ maxAttempts: 10 });
const tableName = process.env.TABLE_NAME!;
const aclStore = new DynamoAclStore(dynamo, tableName);
const scheduleStore = new DynamoScheduleStore(dynamo, tableName);
const taskConfigStore = new DynamoTaskConfigStore(dynamo, tableName);
const userSettingsStore = new DynamoUserSettingsStore(dynamo, tableName);

const SCHEDULER_GROUP_NAME = process.env.SCHEDULER_GROUP_NAME;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN;
const SCHEDULE_TRIGGER_FN_ARN = process.env.SCHEDULE_TRIGGER_FN_ARN;
const SCHEDULE_DLQ_ARN = process.env.SCHEDULE_DLQ_ARN;

const schedulerService = SCHEDULER_GROUP_NAME && SCHEDULER_ROLE_ARN && SCHEDULE_TRIGGER_FN_ARN
  ? new EventBridgeSchedulerService(
      new SchedulerClient({}),
      SCHEDULER_GROUP_NAME,
      SCHEDULER_ROLE_ARN,
      SCHEDULE_TRIGGER_FN_ARN,
      SCHEDULE_DLQ_ARN,
    )
  : null;

export const handler = async (input: DeleteCloudResourcesInput): Promise<DeleteCloudResourcesOutput> => {
  return handleDeleteCloudResources(
    { aclStore, scheduleStore, taskConfigStore, userSettingsStore, schedulerService },
    input,
  );
};
