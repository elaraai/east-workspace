/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Schedule Trigger Lambda
 *
 * Invoked by EventBridge Scheduler to start a dataflow execution
 * for a workspace on a recurring schedule. Mirrors the dataflow start
 * logic in the API handler but runs without user authentication.
 */

import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'node:crypto';
import { getStorage, getScheduleStore } from '@elaraai/e3-aws-storage/init';
import { variant, none } from '@elaraai/east';
import {
  dataflowGetGraph,
  uuidv7,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  type DataflowExecutionState,
} from '@elaraai/e3-core';

const sfn = new SFNClient({});
const storage = getStorage();
const scheduleStore = getScheduleStore();
const DATAFLOW_STATE_MACHINE_ARN = process.env.DATAFLOW_STATE_MACHINE_ARN!;

export interface ScheduleTriggerEvent {
  repo: string;
  workspace: string;
  schedulerExecutionId: string;
  scheduledTime: string;
}

export interface ScheduleTriggerResult {
  status: 'started' | 'skipped';
  reason?: 'disabled' | 'locked' | 'not_found' | 'not_deployed';
  executionId?: string;
  runId?: string;
  schedulerExecutionId?: string;
}

export async function handler(event: ScheduleTriggerEvent): Promise<ScheduleTriggerResult> {
  const { repo, workspace, schedulerExecutionId, scheduledTime } = event;

  console.log(`Schedule trigger: repo=${repo}, workspace=${workspace}, schedulerExecutionId=${schedulerExecutionId}, scheduledTime=${scheduledTime}`);

  // 1. Read schedule from DynamoDB
  const schedule = await scheduleStore.get(repo, workspace);
  if (!schedule) {
    console.log(`Schedule not found for ${repo}/${workspace}, skipping`);
    return { status: 'skipped', reason: 'not_found' };
  }

  if (!schedule.enabled) {
    console.log(`Schedule disabled for ${repo}/${workspace}, skipping`);
    return { status: 'skipped', reason: 'disabled' };
  }

  // 2. Validate workspace exists and is deployed
  try {
    await dataflowGetGraph(storage, repo, workspace);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      console.log(`Workspace ${workspace} not found in repo ${repo}, skipping`);
      return { status: 'skipped', reason: 'not_found' };
    }
    if (err instanceof WorkspaceNotDeployedError) {
      console.log(`Workspace ${workspace} not deployed in repo ${repo}, skipping`);
      return { status: 'skipped', reason: 'not_deployed' };
    }
    throw err;
  }

  // 3. Use forceTasks directly (concrete task names, resolved at CLI time)
  const forceTasks = schedule.forceTasks;
  console.log(`Force tasks: ${forceTasks.length > 0 ? forceTasks.join(', ') : '(none)'}`);

  // 4. Acquire workspace lock
  const lock = await storage.locks.acquire(
    repo,
    `workspace/${workspace}`,
    variant('dataflow', null),
    { wait: false }
  );

  if (!lock) {
    console.log(`Workspace ${repo}/${workspace} is locked, skipping`);
    return { status: 'skipped', reason: 'locked' };
  }

  try {
    // 5. Create execution state
    const execId = await storage.executions.nextExecutionId(repo, workspace);
    const initialState: DataflowExecutionState = {
      id: execId,
      repo,
      workspace,
      startedAt: new Date(),
      concurrency: 4n,
      force: false,
      filter: none,
      graph: none,
      graphHash: none,
      tasks: new Map(),
      executed: 0n,
      cached: 0n,
      failed: 0n,
      skipped: 0n,
      status: 'running',
      completedAt: none,
      error: none,
      events: [],
      eventSeq: 0n,
    };
    await storage.executions.create(initialState);

    // 6. Generate runId and start Step Functions
    const runId = uuidv7();
    const sfnExecutionId = randomUUID();
    const executionName = `dataflow-${repo}-${workspace}-${sfnExecutionId}`.slice(0, 80);

    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: DATAFLOW_STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify({
          repo,
          workspace,
          executionId: parseInt(execId, 10),
          force: false,
          forceTasks,
          runId,
          triggeredBy: {
            type: 'schedule',
            value: { schedulerExecutionId, scheduledTime },
          },
        }),
      })
    );

    console.log(`Started dataflow: execution=${execId}, runId=${runId}, sfn=${executionName}, schedulerExecutionId=${schedulerExecutionId}`);

    return {
      status: 'started',
      executionId: execId,
      runId,
      schedulerExecutionId,
    };
  } catch (err) {
    // Release lock on error
    await lock.release();
    throw err;
  }
}
