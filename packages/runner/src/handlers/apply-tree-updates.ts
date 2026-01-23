/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { workspaceSetDatasetByHash, parsePathString } from '@elaraai/e3-core';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

/** Single tree update from a completed task */
export interface TreeUpdate {
  outputPath: string;
  outputHash: string;
  needsTreeUpdate: boolean;
}

export interface ApplyTreeUpdatesEvent {
  repo: string;
  workspace: string;
  /** Tree updates collected from the Map iteration results */
  treeUpdates: TreeUpdate[];
}

export interface ApplyTreeUpdatesOutput {
  /** Number of updates applied */
  updatesApplied: number;
}

/**
 * Lambda handler: Apply tree updates serially to workspace.
 *
 * Called by Step Functions after the parallel DispatchTasksMap completes.
 * Receives all tree updates collected from write-result and applies them
 * one by one to avoid lost update race conditions.
 */
export async function handler(event: ApplyTreeUpdatesEvent): Promise<ApplyTreeUpdatesOutput> {
  const { repo, workspace, treeUpdates } = event;

  // Filter to only updates that need tree writes (skip failed tasks)
  const pendingUpdates = treeUpdates.filter(u => u.needsTreeUpdate && u.outputPath && u.outputHash);

  console.log(`Applying ${pendingUpdates.length} tree updates to workspace ${workspace}`);

  // Apply updates serially to avoid race conditions
  for (const update of pendingUpdates) {
    console.log(`  Writing ${update.outputPath} = ${update.outputHash.slice(0, 12)}...`);
    const treePath = parsePathString(update.outputPath);
    await workspaceSetDatasetByHash(storage, repo, workspace, treePath, update.outputHash);
  }

  console.log(`Applied ${pendingUpdates.length} tree updates`);

  return { updatesApplied: pendingUpdates.length };
}
