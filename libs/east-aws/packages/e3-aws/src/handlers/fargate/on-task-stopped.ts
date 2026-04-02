/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { SFNClient, SendTaskFailureCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});

export async function handler(event: any): Promise<void> {
  const detail = event.detail;
  const overrides = detail?.overrides?.containerOverrides ?? [];

  // Find TASK_TOKEN and TASK_EVENT from container environment overrides
  let taskToken: string | undefined;
  let taskEvent: any;
  for (const override of overrides) {
    for (const env of override.environment ?? []) {
      if (env.name === 'TASK_TOKEN') taskToken = env.value;
      if (env.name === 'TASK_EVENT') {
        try { taskEvent = JSON.parse(env.value); } catch { /* ignore */ }
      }
    }
  }

  if (!taskToken) return; // Not a Step Functions-managed task

  // Check if any container exited non-zero
  const containers = detail.containers ?? [];
  const failedContainer = containers.find((c: any) => c.exitCode !== 0);
  if (!failedContainer) return; // All containers exited cleanly

  const taskName = taskEvent?.taskName ?? 'unknown';
  const cause = `Container '${failedContainer.name}' exited with code ${failedContainer.exitCode}: ${detail.stoppedReason ?? 'unknown reason'}`;
  console.log(`Fargate crash detected for task ${taskName}: ${cause}`);

  try {
    await sfn.send(new SendTaskFailureCommand({
      taskToken,
      error: 'ContainerCrashed',
      cause,
    }));
    console.log(`Sent task failure for ${taskName}`);
  } catch (err: any) {
    // Token already consumed (happy path won the race) — expected, ignore
    if (err.name === 'TaskTimedOut' || err.name === 'TaskDoesNotExist' || err.name === 'InvalidToken') {
      console.log(`Task token already consumed for ${taskName} (happy path)`);
    } else {
      console.error(`Failed to send task failure for ${taskName}:`, err);
      throw err; // Unexpected error, let Lambda retry
    }
  }
}
