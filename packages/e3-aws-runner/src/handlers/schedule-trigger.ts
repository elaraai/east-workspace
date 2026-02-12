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

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'node:crypto';
import { S3DynamoStorage, DynamoScheduleStore } from '@elaraai/e3-aws-storage';
import { variant, none } from '@elaraai/east';
import {
  dataflowGetGraph,
  uuidv7,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  type DataflowExecutionState,
} from '@elaraai/e3-core';
import { some } from '@elaraai/east';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const sfn = new SFNClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);
const scheduleStore = new DynamoScheduleStore(dynamo, process.env.TABLE_NAME!);
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

/**
 * Convert a glob pattern to a RegExp for matching task names.
 *
 * Syntax:
 * - `*` matches zero or more characters
 * - `\*` matches a literal asterisk
 * - `\\` matches a literal backslash
 */
export function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === '*') {
        regex += '\\*';
        i += 2;
        continue;
      }
      if (next === '\\') {
        regex += '\\\\';
        i += 2;
        continue;
      }
    }
    if (ch === '*') {
      regex += '.*';
      i++;
      continue;
    }
    // Escape regex metacharacters
    regex += ch.replace(/[.+?^${}()|[\]]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${regex}$`);
}

/**
 * Resolve force task patterns against the task graph.
 */
export function resolveForceTaskPatterns(patterns: string[], taskNames: string[]): string[] {
  const forced = new Set<string>();
  for (const pattern of patterns) {
    const re = globToRegex(pattern);
    for (const name of taskNames) {
      if (re.test(name)) {
        forced.add(name);
      }
    }
  }
  return [...forced];
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
  let graph: { tasks: Array<{ name: string; hash: string; inputs: string[]; output: string; dependsOn: string[] }> };
  try {
    graph = await dataflowGetGraph(storage, repo, workspace);
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

  // 3. Resolve forceTaskPatterns against task graph
  const taskNames = graph.tasks.map(t => t.name);
  const forceTasks = resolveForceTaskPatterns(schedule.forceTaskPatterns, taskNames);
  console.log(`Resolved ${schedule.forceTaskPatterns.length} patterns to ${forceTasks.length} forced tasks: ${forceTasks.join(', ')}`);

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
