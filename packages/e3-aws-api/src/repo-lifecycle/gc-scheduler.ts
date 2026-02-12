/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Scheduler Lambda Handler
 *
 * Triggered by EventBridge on a schedule (e.g., daily).
 * Lists all active repos and starts GC for each with random jitter.
 *
 * Jitter is used to spread load and avoid thundering herd:
 * - Base interval is 24 hours
 * - Each repo gets 50%-150% of base interval as delay
 * - For scheduled GC, this means repos are processed throughout the day
 */

import { randomUUID } from 'node:crypto';
import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients once at Lambda cold start
const dynamo = new DynamoDBClient({});
const sfn = new SFNClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const GC_STATE_MACHINE_ARN = process.env.GC_STATE_MACHINE_ARN!;

// Jitter configuration
// With 50%-150% jitter on a daily schedule, repos will be processed
// anywhere from 12 hours to 36 hours after the scheduler runs
const JITTER_MIN_FACTOR = 0.5;
const JITTER_MAX_FACTOR = 1.5;

// Maximum jitter in milliseconds (default: 1 hour for daily schedule)
// This means repos will start GC within 0 to MAX_JITTER_MS of each other
const MAX_JITTER_MS = parseInt(process.env.MAX_JITTER_MS ?? '3600000', 10);

/**
 * Input from EventBridge (can be empty or contain configuration).
 */
export interface GcSchedulerInput {
  /** Optional: force GC even if repo was recently GC'd */
  force?: boolean;
  /** Optional: only GC specific repos */
  repos?: string[];
}

/**
 * Output from the scheduler.
 */
export interface GcSchedulerOutput {
  /** Number of GC executions started */
  started: number;
  /** Number of repos skipped (not active) */
  skipped: number;
  /** Repos that were scheduled */
  scheduledRepos: string[];
}

/**
 * GC Scheduler handler.
 *
 * Lists all active repos and starts GC state machine for each.
 */
export const handler = async (input: GcSchedulerInput = {}): Promise<GcSchedulerOutput> => {
  // Get list of repos to GC
  let repos: string[];
  if (input.repos && input.repos.length > 0) {
    // Specific repos requested
    repos = input.repos;
  } else {
    // Get all active repos
    repos = await listActiveRepos();
  }

  let started = 0;
  let skipped = 0;
  const scheduledRepos: string[] = [];

  for (const repo of repos) {
    try {
      // Check if repo is active (can run GC)
      const canGc = await canRunGc(repo);
      if (!canGc && !input.force) {
        skipped++;
        continue;
      }

      // Calculate jitter delay for this repo
      // Using repo name as seed for consistent jitter across runs
      const jitterMs = calculateJitter(repo);
      const jitterSeconds = Math.floor(jitterMs / 1000);

      // Generate unique GC ID
      const gcId = randomUUID();
      const startTime = Date.now();

      // Start GC state machine with delay
      // The state machine uses jitterSeconds in a Wait state to spread out GC runs
      const executionName = `gc-${repo}-${gcId.slice(0, 8)}`;

      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: GC_STATE_MACHINE_ARN,
          name: executionName,
          input: JSON.stringify({
            repo,
            gcId,
            startTime,
            jitterSeconds, // Used by state machine Wait state
          }),
        })
      );

      started++;
      scheduledRepos.push(repo);
    } catch (err) {
      console.error(`Failed to start GC for repo ${repo}:`, err);
    }
  }

  return {
    started,
    skipped,
    scheduledRepos,
  };
};

/**
 * List all repos with status='active'.
 */
async function listActiveRepos(): Promise<string[]> {
  const repos: string[] = [];
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const response = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({
          ':pk': 'REPO',
          ':active': 'active',
        }),
        ProjectionExpression: 'SK',
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: true,
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        // SK is the repo name directly
        const sk = unmarshall(item).SK as string;
        repos.push(sk);
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return repos;
}

/**
 * Check if a repo can run GC (must be in 'active' state).
 */
async function canRunGc(repo: string): Promise<boolean> {
  const response = await dynamo.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: 'REPO',
        SK: repo,
      }),
      ConsistentRead: true,
      ProjectionExpression: '#status',
      ExpressionAttributeNames: { '#status': 'status' },
    })
  );

  if (!response.Item) {
    return false;
  }

  const status = response.Item.status?.S;
  return status === 'active';
}

/**
 * Calculate jitter delay for a repo.
 *
 * Uses repo name to generate consistent jitter, so the same repo
 * gets the same relative delay across scheduler runs.
 *
 * Returns delay in milliseconds (0 to MAX_JITTER_MS).
 */
function calculateJitter(repo: string): number {
  // Simple hash of repo name to get a number between 0 and 1
  let hash = 0;
  for (let i = 0; i < repo.length; i++) {
    const char = repo.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const normalized = Math.abs(hash) / 2147483647; // 0 to 1

  // Apply jitter factor (50% to 150%)
  const jitterFactor = JITTER_MIN_FACTOR + (normalized * (JITTER_MAX_FACTOR - JITTER_MIN_FACTOR));

  // Scale to max jitter
  return Math.floor(jitterFactor * MAX_JITTER_MS);
}
