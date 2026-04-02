/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Scheduler Lambda Handler — thin wrapper.
 */

import { SFNClient } from '@aws-sdk/client-sfn';
import { getStorage } from '../../storage/init.js';
import { handleGcScheduler } from '@elaraai/e3-cloud-core/gc';
import type { GcSchedulerInput, GcSchedulerOutput } from '@elaraai/e3-cloud-core/gc';
import { SfnGcOrchestrator } from '../../services/sfn-gc-orchestrator.js';

export type { GcSchedulerInput, GcSchedulerOutput } from '@elaraai/e3-cloud-core/gc';
export { calculateJitter } from '@elaraai/e3-cloud-core/gc';

const storage = getStorage();
const gcOrchestrator = new SfnGcOrchestrator(new SFNClient({}), process.env.GC_STATE_MACHINE_ARN!);

/** Lambda handler: thin wrapper that injects dependencies. */
export const handler = async (input: GcSchedulerInput = {}): Promise<GcSchedulerOutput> => {
  return handleGcScheduler(
    { repoManager: storage.repoManager, gcOrchestrator },
    input,
  );
};
