/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Schedule Trigger Lambda
 *
 * Invoked by EventBridge Scheduler to start a dataflow execution
 * for a workspace on a recurring schedule.
 */

import { SFNClient } from '@aws-sdk/client-sfn';
import { getStorage, getScheduleStore } from '../../storage/init.js';
import { SfnDataflowOrchestrator } from '../../services/sfn-dataflow-orchestrator.js';
import { handleScheduleTrigger } from '@elaraai/e3-cloud-core/steps';
import type { ScheduleTriggerEvent, ScheduleTriggerResult } from '@elaraai/e3-cloud-core/steps';

export type { ScheduleTriggerDeps, ScheduleTriggerEvent, ScheduleTriggerResult } from '@elaraai/e3-cloud-core/steps';
export { handleScheduleTrigger } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: ScheduleTriggerEvent): Promise<ScheduleTriggerResult> {
  const storage = getStorage();
  const scheduleStore = getScheduleStore();
  const sfn = new SFNClient({});
  const stateMachineArn = process.env.DATAFLOW_STATE_MACHINE_ARN!;
  const orchestrator = new SfnDataflowOrchestrator(sfn, stateMachineArn);

  return handleScheduleTrigger({ storage, scheduleStore, orchestrator }, event);
}
